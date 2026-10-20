import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/lifecycle.mjs";

const work = (count, sessionId = "session-one") => ({ sessionId, count });

test("delegated work snapshots retain pending reports across parent settlement without polling", async (t) => {
  const h = harness(t);
  await h.start();
  await h.emit("subagents:work", work(2));
  await h.emit("agent_settled");
  assert.equal(h.pipes.at(-1).mode, "working");
  await h.emit("subagents:work", work(1));
  assert.equal(h.pipes.at(-1).mode, "working");
  await h.emit("watcher:status", { key: "watcher:watch-sentry", status: "polling" });
  await h.tick(500);
  assert.equal(h.entryReads(), 0);
  await h.emit("subagents:work", work(0));
  assert.equal(h.pipes.at(-1).mode, "done");
  assert.deepEqual(h.pipes.at(-1).watcher_states, { S: { status: "polling" } });
  const done = h.pipes.at(-1);
  await h.emit("subagents:work", work(0));
  await h.tick(4_500);
  assert.deepEqual(h.pipes.at(-1), done, "sidebar replay stays independent of work tracking");
  assert.equal(h.entryReads(), 0);
});

for (const sessionId of ["session-one", "other-session"]) {
  test(`initial snapshot before session_start belongs only to ${sessionId}`, async (t) => {
    const h = harness(t);
    await h.emit("subagents:work", work(3, sessionId));
    await h.emit("session_start");
    assert.equal(h.pipes.at(-1).mode, sessionId === "session-one" ? "working" : "base");
  });
}

test("session replacement clears previous work and same-session restoration reapplies its snapshot", async (t) => {
  let sessionId = "session-one";
  const h = harness(t, { ctx: { sessionManager: { getSessionId: () => sessionId } } });
  await h.emit("session_start");
  await h.emit("subagents:work", work(2));
  await h.emit("session_start");
  assert.equal(h.pipes.at(-1).mode, "working");
  sessionId = "session-two";
  await h.emit("session_start");
  assert.equal(h.pipes.at(-1).mode, "base");
  await h.emit("subagents:work", work(0));
  assert.equal(h.pipes.at(-1).mode, "base");
  await h.emit("subagents:work", work(1, sessionId));
  assert.equal(h.pipes.at(-1).mode, "working");
});

test("invalid, foreign, duplicate and shutdown snapshots cannot change current activity", async (t) => {
  const h = harness(t);
  await h.emit("session_start");
  const before = h.pipes.length;
  for (const snapshot of [null, [], 1, {}, work(1, "other"), work(1, ""), work(-1),
    work(0.5), work(NaN), work(Infinity), work(Number.MAX_SAFE_INTEGER + 1), work("1"), work(0)]) {
    await h.emit("subagents:work", snapshot);
  }
  assert.equal(h.pipes.length, before);
  await h.emit("subagents:work", work(1));
  await h.emit("agent_start");
  await h.emit("subagents:work", work(0));
  assert.equal(h.pipes.at(-1).mode, "working", "parent still owns work");
  await h.emit("agent_settled");
  assert.equal(h.pipes.at(-1).mode, "done");
  await h.emit("session_shutdown");
  const count = h.pipes.length;
  await h.emit("subagents:work", work(2));
  assert.equal(h.pipes.length, count);
});

test("delegated work and independent legacy lifecycle ids do not release each other", async (t) => {
  const h = harness(t);
  await h.emit("session_start");
  await h.emit("subagents:started", { id: "external-child" });
  await h.emit("subagents:work", work(1));
  await h.emit("subagents:work", work(0));
  assert.equal(h.pipes.at(-1).mode, "working");
  await h.emit("subagents:completed", { id: "external-child" });
  assert.equal(h.pipes.at(-1).mode, "done");
});

test("delegated completion during compaction remains done after compaction", async (t) => {
  const h = harness(t);
  await h.emit("session_start");
  await h.emit("subagents:work", work(1));
  await h.emit("session_before_compact");
  await h.emit("subagents:work", work(0));
  assert.equal(h.pipes.at(-1).mode, "compacting");
  await h.emit("session_compact");
  assert.equal(h.pipes.at(-1).mode, "done");
});
