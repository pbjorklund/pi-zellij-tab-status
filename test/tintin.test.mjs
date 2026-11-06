import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/lifecycle.mjs";
import { createTintinObserver } from "../lib/tintin.ts";

const key = Symbol.for("pi-subagents:manager");
function registry(t, records) {
  const old = globalThis[key];
  const manager = { getRecord: id => records.get(id), hasRunning: () => [...records.values()].some(r => ["queued", "running"].includes(r.status)) };
  globalThis[key] = manager;
  t.after(() => { if (old === undefined) delete globalThis[key]; else globalThis[key] = old; });
  return manager;
}

test("Tintin queue keeps working after the parent and running child settle, then a silent queued stop clears it", async t => {
  const records = new Map([["running", { id: "running", status: "running" }], ["queued", { id: "queued", status: "queued" }]]);
  registry(t, records);
  const h = harness(t);
  await h.start();
  await h.emit("subagents:started", { id: "running" });
  await h.emit("agent_settled");
  records.get("running").status = "done";
  records.get("running").resultConsumed = true;
  await h.emit("subagents:completed", { id: "running" });
  assert.equal(h.pipes.at(-1).mode, "working");
  records.get("queued").status = "stopped";
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "done");
  const count = h.pipes.length;
  await h.tick(250);
  assert.equal(h.pipes.length, count);
});

test("Tintin created queue can stop without any started or terminal event", async t => {
  const records = new Map([["queued", { id: "queued", status: "queued" }]]);
  registry(t, records);
  const h = harness(t);
  await h.emit("session_start");
  await h.emit("subagents:created", { id: "queued" });
  assert.equal(h.pipes.at(-1).mode, "working");
  records.get("queued").status = "stopped";
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "done");
});

test("registry and lifecycle evidence stay independent of pending-report snapshots", async t => {
  const records = new Map([["a", { id: "a", status: "running" }]]);
  registry(t, records);
  const h = harness(t);
  await h.start();
  await h.emit("subagents:started", { id: "a" });
  await h.emit("subagents:started", { id: "a" });
  await h.emit("subagents:work", { sessionId: "session-one", count: 1 });
  await h.emit("agent_settled");
  records.get("a").status = "done";
  records.get("a").resultConsumed = true;
  await h.emit("subagents:completed", { id: "a", resultConsumed: false });
  await h.emit("subagents:completed", { id: "a" });
  assert.equal(h.pipes.at(-1).mode, "working");
  await h.emit("subagents:work", { sessionId: "session-one", count: 0 });
  assert.equal(h.pipes.at(-1).mode, "done");
});

test("Tintin polling resets on session replacement and shutdown", async t => {
  const records = new Map([["a", { id: "a", status: "queued" }]]);
  const manager = registry(t, records);
  let reads = 0;
  const hasRunning = manager.hasRunning;
  manager.hasRunning = () => { reads++; return hasRunning(); };
  const h = harness(t);
  await h.emit("session_start");
  await h.emit("subagents:created", { id: "a" });
  await h.emit("session_start");
  const before = reads;
  await h.tick(250);
  assert.equal(reads, before);
  assert.equal(h.pipes.at(-1).mode, "base");
  await h.emit("subagents:created", { id: "a" });
  await h.emit("session_shutdown");
  const closed = reads;
  await h.emit("subagents:created", { id: "a" });
  await h.tick(250);
  assert.equal(reads, closed);
});

test("Tintin queue cancellation during compaction does not end compaction", async t => {
  const records = new Map([["a", { id: "a", status: "queued" }]]);
  registry(t, records);
  const h = harness(t);
  await h.emit("session_start");
  await h.emit("subagents:created", { id: "a" });
  await h.emit("session_before_compact");
  records.get("a").status = "stopped";
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "compacting");
  await h.emit("session_compact_failed");
  assert.equal(h.pipes.at(-1).mode, "done");
});

test("registry failures and replacement never manufacture a completion", t => {
  const records = new Map([["a", { id: "a", status: "running" }]]);
  const manager = registry(t, records);
  const changes = [];
  const observer = createTintinObserver(value => changes.push(value));
  t.after(() => observer.reset());
  observer.refresh();
  for (const candidate of [undefined, {}, { getRecord: 1 }, { getRecord() {} }]) {
    globalThis[key] = candidate;
    observer.observe("a");
  }
  globalThis[key] = { getRecord() { throw new Error("unavailable"); }, hasRunning() {} };
  observer.observe("a");
  globalThis[key] = manager;
  observer.observe("a");
  assert.deepEqual(changes, [true]);
  manager.hasRunning = () => { throw new Error("unavailable"); };
  observer.refresh();
  manager.hasRunning = () => "invalid";
  observer.refresh();
  delete globalThis[key];
  observer.refresh();
  assert.deepEqual(changes, [true]);
  observer.reset();
});

for (const terminal of ["subagents:completed", "subagents:failed"]) {
  test(`${terminal}: an explicit unconsumed report holds working after execution stops`, async t => {
    const record = { id: "a", status: "running", resultConsumed: false };
    registry(t, new Map([["a", record]]));
    const h = harness(t);
    await h.start();
    await h.emit("subagents:started", { id: "a" });
    await h.emit("agent_settled");
    record.status = "completed";
    await h.emit(terminal, { id: "a" });
    await h.emit(terminal, { id: "a" });
    await h.tick(250);
    assert.equal(h.pipes.at(-1).mode, "working");
    record.resultConsumed = true;
    await h.tick(250);
    assert.equal(h.pipes.at(-1).mode, "done");
  });
}

test("consumption releases a known report only after the parent settles", async t => {
  const record = { id: "a", status: "running", resultConsumed: false };
  registry(t, new Map([["a", record]]));
  const h = harness(t);
  await h.start();
  await h.emit("subagents:started", { id: "a" });
  record.status = "completed";
  await h.emit("subagents:completed", { id: "a" });
  record.resultConsumed = true;
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "working");
  await h.emit("agent_settled");
  assert.equal(h.pipes.at(-1).mode, "done");
});

test("missing or malformed report records and registry failures cannot fake consumption", async t => {
  const records = new Map([["a", { id: "a", status: "running", resultConsumed: false }]]);
  const manager = registry(t, records);
  const h = harness(t);
  await h.start();
  await h.emit("subagents:started", { id: "a" });
  await h.emit("agent_settled");
  records.set("a", { id: "a", status: "completed", resultConsumed: false });
  await h.emit("subagents:completed", { id: "a" });
  manager.hasRunning = () => false;
  for (const value of [undefined, null, [], {}, { id: "foreign", resultConsumed: true },
    { id: "a" }, { id: "a", resultConsumed: "true" }]) {
    records.set("a", value);
    await h.tick(250);
    assert.equal(h.pipes.at(-1).mode, "working");
  }
  const getRecord = manager.getRecord;
  manager.getRecord = () => { throw new Error("missing record"); };
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "working");
  manager.getRecord = getRecord;
  globalThis[key] = { getRecord: () => ({ id: "a", resultConsumed: true }), hasRunning: () => false };
  await h.emit("subagents:created", { id: "a" });
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "working");
  globalThis[key] = manager;
  records.set("a", { id: "a", status: "completed", resultConsumed: true });
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "done");
});

test("known reports and snapshots release independently without counting duplicate terminals", async t => {
  const record = { id: "a", status: "running", resultConsumed: false };
  registry(t, new Map([["a", record]]));
  const h = harness(t);
  await h.start();
  await h.emit("subagents:started", { id: "a" });
  await h.emit("subagents:work", { sessionId: "session-one", count: 1 });
  await h.emit("agent_settled");
  record.status = "completed";
  await h.emit("subagents:completed", { id: "a" });
  await h.emit("subagents:completed", { id: "a" });
  await h.emit("subagents:work", { sessionId: "session-one", count: 0 });
  assert.equal(h.pipes.at(-1).mode, "working");
  record.resultConsumed = true;
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "done");
  const count = h.pipes.length;
  await h.emit("subagents:completed", { id: "a" });
  await h.tick(250);
  assert.equal(h.pipes.length, count);
});

test("session replacement clears report ownership and ignores unmatched terminal ids", async t => {
  const record = { id: "a", status: "running", resultConsumed: false };
  registry(t, new Map([["a", record]]));
  const h = harness(t);
  await h.start();
  await h.emit("subagents:started", { id: "a" });
  record.status = "completed";
  await h.emit("subagents:completed", { id: "a" });
  await h.emit("agent_settled");
  assert.equal(h.pipes.at(-1).mode, "working");
  await h.emit("session_start");
  await h.emit("subagents:completed", { id: "a" });
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "base");
});

test("queued stop without a terminal event creates no pending report", async t => {
  const record = { id: "queued", status: "queued", resultConsumed: false };
  registry(t, new Map([["queued", record]]));
  const h = harness(t);
  await h.emit("session_start");
  await h.emit("subagents:created", { id: "queued" });
  record.status = "stopped";
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "done");
});

test("a child activation never adopts the root registry from an unmatched id", async t => {
  registry(t, new Map([["root-child", { id: "root-child", status: "running" }]]));
  const h = harness(t);
  await h.start();
  await h.emit("subagents:started", { id: "child-owned" });
  await h.emit("agent_settled");
  await h.emit("subagents:completed", { id: "child-owned" });
  await h.tick(250);
  assert.equal(h.pipes.at(-1).mode, "done");
});
