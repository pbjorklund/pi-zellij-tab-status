import { required } from "./helpers/guards.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/lifecycle.ts";

const modes = (h: ReturnType<typeof harness>) => h.pipes.flatMap((message) => message.kind === "snapshot" ? [message.mode] : []);

test("watcher detail changes publish while idle and carry only the folder basename", async (t) => {
  const h = harness(t, { ctx: { cwd: "/projects/backoffice" } });
  await h.emit("session_start");
  assert.equal(required(h.pipes.at(-1)).folder, "backoffice");
  await h.emit("watcher:status", { key: "watcher:af-watch-project-task", status: "working" });
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "error" });
  assert.deepEqual(required(h.pipes.at(-1)).watcher_states, { C: { status: "error" }, P: { status: "working" } });
  const seq = required(h.pipes.at(-1)).seq;
  await h.emit("watcher:status", { key: "watcher:af-watch-project-task", status: "polling" });
  assert.ok(required(h.pipes.at(-1)).seq > seq);
  assert.equal(required(h.pipes.at(-1)).mode, "base");
  assert.equal(required(required(h.pipes.at(-1)).watcher_states).P.status, "polling");
  await h.emit("watcher:status", { key: "watcher:af-watch-project-task", status: "waiting", waitingKind: "human" });
  assert.deepEqual(required(required(h.pipes.at(-1)).watcher_states).P, { status: "waiting", waiting_kind: "human" });
  await h.emit("watcher:status", { key: "watcher:af-watch-project-task", status: "waiting", waitingKind: "invalid" });
  assert.deepEqual(required(required(h.pipes.at(-1)).watcher_states).P, { status: "waiting", waiting_kind: "other" });
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "off" });
  await h.emit("watcher:status", { key: "watcher:af-watch-project-task", status: "off" });
  assert.equal(required(h.pipes.at(-1)).watcher_states, undefined);
});

test("lifecycle: compaction and settlement publish semantic transitions", async (t) => {
  const h = harness(t, { runtimeId: "lifecycle" });
  await h.start();
  await h.emit("session_before_compact", { reason: "threshold", willRetry: false });
  await h.emit("session_compact", { reason: "threshold", willRetry: false });
  await h.emit("agent_settled");

  assert.deepEqual(modes(h), ["base", "working", "compacting", "working", "done"]);
  assert.equal(h.hasHandler("agent_end"), false);
});

test("lifecycle: failed compaction restores the effective work state", async (t) => {
  const h = harness(t);
  await h.start();
  await h.emit("session_before_compact");
  await h.emit("session_compact_failed", { aborted: false });
  assert.deepEqual(modes(h).slice(-2), ["compacting", "working"]);
});

test("replay: active work republishes the same snapshot for new sidebars", async (t) => {
  const h = harness(t, { statusReplayIntervalMs: 5 });
  await h.start();
  const working = required(h.pipes.at(-1));
  const writes = h.writes.length;

  await h.tick(5);

  assert.deepEqual(h.pipes.slice(-2), [working, working]);
  assert.equal(h.writes.length, writes);
});

test("replay: idle folder metadata reaches newly loaded sidebars without discovery", async (t) => {
  const h = harness(t, { statusReplayIntervalMs: 5 });
  await h.emit("session_start");
  const snapshot = required(h.pipes.at(-1));
  const discovery = h.calls.filter(({ args }) => args[0] !== "pipe").length;
  await h.tick(5);
  assert.deepEqual(required(h.pipes.at(-1)), snapshot);
  assert.equal(h.pipes.length, 2);
  assert.equal(h.calls.filter(({ args }) => args[0] !== "pipe").length, discovery);
});

test("obsolete watcher aliases cannot enable or revive watcher state", async (t) => {
  const h = harness(t);
  await h.emit("session_start");
  for (const key of ["watcher:cw", "watcher:iw", "watcher:pw", "watcher:rw", "watcher:sw"]) {
    await h.emit("watcher:status", { key, status: "working" });
  }
  assert.equal(h.pipes.length, 1);
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "working" });
  assert.deepEqual(required(h.pipes.at(-1)).watcher_states, { C: { status: "working" } });
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "off" });
  await h.emit("watcher:status", { key: "watcher:cw", status: "working" });
  assert.equal(required(h.pipes.at(-1)).watcher_states, undefined);
  assert.equal(required(h.pipes.at(-1)).watchers, undefined);
});

test("watcher events publish sorted letters and clear them without changing the agent mode", async (t) => {
  const h = harness(t, { runtimeId: "watch-test", statusReplayIntervalMs: 5 });
  await h.emit("session_start");
  await h.emit("watcher:status", { key: "watcher:watch-sentry", status: "working" });
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "polling" });
  assert.equal(required(h.pipes.at(-1)).mode, "base");
  assert.deepEqual(required(h.pipes.at(-1)).watcher_states, { C: { status: "polling" }, S: { status: "working" } });
  const count = h.pipes.length;
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "polling" });
  await h.emit("watcher:status", { key: "not-a-watcher", status: "working" });
  assert.equal(h.pipes.length, count);
  await h.tick(5);
  assert.deepEqual(required(h.pipes.at(-1)), h.pipes.at(-2), "base watcher status is replayed for a late sidebar");
  await h.emit("watcher:status", { key: "watcher:watch-sentry", status: "off" });
  assert.deepEqual(required(h.pipes.at(-1)).watcher_states, { C: { status: "polling" } });
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "off" });
  assert.equal(required(h.pipes.at(-1)).watcher_states, undefined);
});

test("restored watcher states publish on session start and idle changes without an agent turn", async (t) => {
  const h = harness(t, { runtimeId: "restored-watchers" });
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "working" });
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "off" });
  await h.emit("watcher:status", { key: "watcher:af-watch-improvement", status: "polling" });
  await h.emit("session_start");
  assert.equal(required(h.pipes.at(-1)).mode, "base");
  assert.deepEqual(required(h.pipes.at(-1)).watcher_states, { I: { status: "polling" } });
  for (const status of ["polling", "queued", "working", "waiting", "paused", "error"]) {
    for (const key of ["watcher:af-watch-checklist", "watcher:af-watch-improvement", "watcher:watch-github-pr", "watcher:watch-sentry"]) {
      await h.emit("watcher:status", { key, status });
    }
    const detail = { status, ...(status === "waiting" ? { waiting_kind: "other" } : {}) };
    assert.deepEqual(required(h.pipes.at(-1)).watcher_states, { C: detail, I: detail, R: detail, S: detail });
    assert.equal(required(h.pipes.at(-1)).mode, "base", status);
    for (const key of ["watcher:af-watch-checklist", "watcher:af-watch-improvement", "watcher:watch-github-pr", "watcher:watch-sentry"]) {
      await h.emit("watcher:status", { key, status: "off" });
    }
    assert.equal(required(h.pipes.at(-1)).watcher_states, undefined, status);
  }
});

test("perf: transitions within the binding TTL do not repeat discovery or Git reads", async (t) => {
  const h = harness(t);
  await h.start();
  const panes = h.calls.filter(({ args }) => args[1] === "list-panes").length;
  const git = h.calls.filter(({ command }) => command === "git").length;
  await h.emit("agent_settled");
  assert.equal(h.calls.filter(({ args }) => args[1] === "list-panes").length, panes);
  assert.equal(h.calls.filter(({ command }) => command === "git").length, git);
  assert.equal(required(h.pipes.at(-1)).mode, "done");
});
