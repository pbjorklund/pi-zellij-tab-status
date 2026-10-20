import test from "node:test";
import assert from "node:assert/strict";
import { flush, harness } from "./helpers/lifecycle.mjs";

const work = (count) => ({ sessionId: "session-one", count });
const modes = (h) => h.pipes.flatMap((message) => message.kind === "snapshot" ? [message.mode] : []);

for (const reason of ["threshold", "overflow", "manual"]) {
  test(`activity: ${reason} compaction replays status without title frame traffic`, async (t) => {
    const h = harness(t);
    await h.emit("session_start");
    await h.emit("session_before_compact", { reason, willRetry: false });
    const compacting = h.pipes.at(-1);
    const writes = h.writes.length;
    await h.tick(5_000);
    assert.deepEqual(h.pipes.slice(-2), [compacting, compacting]);
    assert.equal(h.writes.length, writes);
    await h.emit("session_compact", { reason, willRetry: false });
    assert.deepEqual(modes(h).slice(-2), ["compacting", "base"]);
  });
}

for (const terminal of ["session_compact", "session_compact_failed"]) {
  test(`activity: child completion during ${terminal} remains done`, async (t) => {
    const h = harness(t);
    await h.emit("session_start");
    await h.emit("subagents:started", { id: "child" });
    await h.emit("session_before_compact");
    h.fire("subagents:completed", { id: "child" });
    await h.emit(terminal);
    assert.equal(modes(h).at(-1), "done");
  });
}

test("activity: current subagent jobs keep working after parent settlement", async (t) => {
  const h = harness(t);
  await h.start();
  h.fire("subagents:work", work(1));
  h.fire("agent_settled");
  await flush();
  assert.equal(modes(h).at(-1), "working");
  await h.emit("subagents:work", work(0));
  assert.equal(modes(h).at(-1), "done");
});

test("activity: same-mode subagent events repair a failed working snapshot", async (t) => {
  const h = harness(t);
  await h.emit("session_start");
  h.failPipes(1);
  await h.emit("agent_start");

  h.fire("subagents:work", work(1));
  h.fire("subagents:work", work(2));
  h.fire("agent_settled");
  await flush();

  assert.equal(modes(h).at(-1), "working");
  await h.emit("subagents:work", work(1));
  assert.equal(modes(h).at(-1), "working");
  await h.emit("subagents:work", work(0));
  assert.equal(modes(h).at(-1), "done");
});

test("activity: malformed and unrelated job events publish no extra status", async (t) => {
  const h = harness(t);
  await h.emit("session_start");
  const before = h.pipes.length;
  for (const event of [null, undefined, 1, "job", [], {}, { id: " " }]) {
    h.fire("subagents:started", event);
    h.fire("subagents:completed", event);
    h.fire("subagents:failed", event);
  }
  await flush();
  assert.equal(h.pipes.length, before);
});
