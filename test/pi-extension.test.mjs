import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/lifecycle.mjs";

const modes = (h) => h.pipes.flatMap((message) => message.kind === "snapshot" ? [message.mode] : []);

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
  const working = h.pipes.at(-1);
  const writes = h.writes.length;

  await h.tick(5);

  assert.deepEqual(h.pipes.slice(-2), [working, working]);
  assert.equal(h.writes.length, writes);
});

test("replay: base state produces no periodic transport", async (t) => {
  const h = harness(t, { statusReplayIntervalMs: 5 });
  await h.emit("session_start");
  const calls = h.calls.length;

  await h.tick(60_000);

  assert.equal(h.calls.length, calls);
});

test("renamed watcher identities preserve one sorted letter each and canonical off overrides stale aliases", async (t) => {
  const h = harness(t, { runtimeId: "renamed-watchers" });
  await h.emit("session_start");
  const pairs = [
    ["watcher:cw", "watcher:af-watch-checklist", "C"],
    ["watcher:iw", "watcher:af-watch-improvement", "I"],
    ["watcher:pw", "watcher:af-watch-project-task", "P"],
    ["watcher:rw", "watcher:watch-github-pr", "R"],
    ["watcher:sw", "watcher:watch-sentry", "S"],
  ];
  for (const [legacy, canonical] of pairs) {
    await h.emit("watcher:status", { key: legacy, status: "working" });
    await h.emit("watcher:status", { key: canonical, status: "working" });
  }
  assert.equal(h.pipes.at(-1).watchers, "CIPRS");
  for (const [, canonical] of pairs) await h.emit("watcher:status", { key: canonical, status: "off" });
  assert.equal(h.pipes.at(-1).watchers, undefined);
  for (const [legacy, canonical, letter] of pairs) {
    await h.emit("watcher:status", { key: legacy, status: "working" });
    assert.equal(h.pipes.at(-1).watchers, undefined, `${letter} must not reappear from a stale alias`);
    await h.emit("watcher:status", { key: canonical, status: "paused" });
    assert.equal(h.pipes.at(-1).watchers, letter);
    await h.emit("watcher:status", { key: canonical, status: "off" });
  }
  assert.equal(h.pipes.at(-1).watchers, undefined);
});

test("watcher events publish sorted letters and clear them without changing the agent mode", async (t) => {
  const h = harness(t, { runtimeId: "watch-test", statusReplayIntervalMs: 5 });
  await h.emit("session_start");
  await h.emit("watcher:status", { key: "watcher:sw", status: "working" });
  await h.emit("watcher:status", { key: "watcher:cw", status: "polling" });
  assert.equal(h.pipes.at(-1).mode, "base");
  assert.equal(h.pipes.at(-1).watchers, "CS");
  const count = h.pipes.length;
  await h.emit("watcher:status", { key: "watcher:cw", status: "polling" });
  await h.emit("watcher:status", { key: "not-a-watcher", status: "working" });
  assert.equal(h.pipes.length, count);
  await h.tick(5);
  assert.deepEqual(h.pipes.at(-1), h.pipes.at(-2), "base watcher status is replayed for a late sidebar");
  await h.emit("watcher:status", { key: "watcher:sw", status: "off" });
  assert.equal(h.pipes.at(-1).watchers, "C");
  await h.emit("watcher:status", { key: "watcher:cw", status: "off" });
  assert.equal(h.pipes.at(-1).watchers, undefined);
});

test("restored watcher states publish on session start and idle changes without an agent turn", async (t) => {
  const h = harness(t, { runtimeId: "restored-watchers" });
  await h.emit("watcher:status", { key: "watcher:cw", status: "working" });
  await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "off" });
  await h.emit("watcher:status", { key: "watcher:af-watch-improvement", status: "polling" });
  await h.emit("session_start");
  assert.equal(h.pipes.at(-1).mode, "base");
  assert.equal(h.pipes.at(-1).watchers, "I");
  for (const status of ["polling", "queued", "working", "waiting", "paused", "error"]) {
    for (const key of ["watcher:af-watch-checklist", "watcher:af-watch-improvement", "watcher:watch-github-pr", "watcher:watch-sentry"]) {
      await h.emit("watcher:status", { key, status });
    }
    assert.equal(h.pipes.at(-1).watchers, "CIRS", status);
    assert.equal(h.pipes.at(-1).mode, "base", status);
    for (const key of ["watcher:af-watch-checklist", "watcher:af-watch-improvement", "watcher:watch-github-pr", "watcher:watch-sentry"]) {
      await h.emit("watcher:status", { key, status: "off" });
    }
    assert.equal(h.pipes.at(-1).watchers, undefined, status);
  }
});

test("watcher activity notices track delegated workers independently of letters and parent work", async (t) => {
  const h = harness(t);
  await h.emit("session_start");
  const notice = async (id, status) => {
    h.appendEntry({ type: "custom_message", customType: "subagent_activity", details: { id, status } });
    await h.tick(500);
  };
  for (const key of ["af-watch-checklist", "af-watch-improvement", "af-watch-project-task", "watch-github-pr", "watch-sentry"]) {
    await h.emit("watcher:status", { key: `watcher:${key}`, status: "polling" });
  }
  assert.equal(h.pipes.at(-1).mode, "base");
  for (const status of ["completed", "failed", "timed_out", "cancelled"]) {
    await notice(`checklist-${status}`, "started");
    await notice(`improvement-${status}`, "started");
    await notice(`sentry-${status}`, "started");
    await notice(`checklist-${status}`, status);
    await h.emit("watcher:status", { key: "watcher:af-watch-checklist", status: "off" });
    assert.equal(h.pipes.at(-1).watchers, "IPRS");
    assert.equal(h.pipes.at(-1).mode, "working");
    await notice(`improvement-${status}`, status);
    assert.equal(h.pipes.at(-1).mode, "working");
    await h.emit("agent_start");
    await notice(`sentry-${status}`, status);
    assert.equal(h.pipes.at(-1).mode, "working");
    await h.emit("agent_settled");
    assert.equal(h.pipes.at(-1).mode, "done");
    assert.equal(h.pipes.at(-1).watchers, "IPRS");
  }
  const count = h.pipes.length;
  for (const entry of [{ type: "message" }, { type: "custom_message", customType: "other" },
    { type: "custom_message", customType: "subagent_activity" },
    { type: "custom_message", customType: "subagent_activity", details: { id: "", status: "started" } },
    { type: "custom_message", customType: "subagent_activity", details: { id: "unknown", status: "queued" } },
  ]) h.appendEntry(entry);
  await h.tick(500);
  await notice("sentry", "completed");
  assert.equal(h.pipes.length, count);
  h.appendEntry({ type: "custom_message", customType: "subagent_activity", details: { id: "fast", status: "started" } });
  h.appendEntry({ type: "custom_message", customType: "subagent_activity", details: { id: "fast", status: "completed" } });
  await h.tick(500);
  assert.equal(h.pipes.at(-1).mode, "done", "one scan preserves chronological notices");
  for (const key of ["af-watch-improvement", "af-watch-project-task", "watch-github-pr", "watch-sentry"]) {
    await h.emit("watcher:status", { key: `watcher:${key}`, status: "off" });
  }
  const reads = h.entryReads();
  await h.tick(5_000);
  assert.equal(h.entryReads(), reads, "no history polling after watchers and workers stop");
  assert.deepEqual(h.writes, []);
});

test("perf: transitions within the binding TTL do not repeat discovery or Git reads", async (t) => {
  const h = harness(t);
  await h.start();
  const panes = h.calls.filter(({ args }) => args[1] === "list-panes").length;
  const git = h.calls.filter(({ command }) => command === "git").length;
  await h.emit("agent_settled");
  assert.equal(h.calls.filter(({ args }) => args[1] === "list-panes").length, panes);
  assert.equal(h.calls.filter(({ command }) => command === "git").length, git);
  assert.equal(h.pipes.at(-1).mode, "done");
});
