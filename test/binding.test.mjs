import test from "node:test";
import assert from "node:assert/strict";
import { flush, harness } from "./helpers/lifecycle.mjs";

const pane = (tabId, tabName, cwd = "/repo") => JSON.stringify([
  { id: 248, tab_id: tabId, tab_name: tabName, pane_cwd: cwd, pane_command: "pi" },
]);

test("binding: startup preserves an explicit name through work, settlement, and shutdown", async (t) => {
  const h = harness(t);
  h.setPaneOutput(pane(26, "My explicit name"));
  await h.emit("session_start");
  await h.emit("agent_start");
  await h.tick(60_000);
  await h.emit("agent_settled");
  await h.fire("session_shutdown");
  assert.deepEqual(h.writes, []);
  assert.equal(h.calls.some(({ command }) => command === "git"), false);
  assert.deepEqual(h.pipes.filter(({ kind }) => kind === "snapshot").map(({ mode }) => mode),
    ["base", "working", "working", "done"]);
  assert.equal(h.pipes.at(-1).kind, "remove");
});

test("binding: a transient discovery miss retains a known existing tab", async (t) => {
  const h = harness(t);
  await h.start();
  await h.tick(5_000);
  h.setPaneOutput("[]");
  const before = h.calls.length;
  await h.emit("agent_settled");
  assert.equal(h.calls.slice(before).filter(({ args }) => args[1] === "list-panes").length, 1);
  assert.equal(h.pipes.at(-1)?.mode, "done");
});

test("binding: discovery retries without writing a title", async (t) => {
  const h = harness(t);
  h.setPaneOutput("[]");
  await h.emit("session_start");
  h.setPaneOutput(pane(26, "legacy"));
  await h.tick(100);
  assert.equal(h.calls.filter(({ args }) => args[1] === "list-panes").length, 2);
  assert.deepEqual(h.writes, []);
  await h.emit("agent_start");
  assert.equal(h.pipes.at(-1).mode, "working");
});

test("binding: shutdown aborts pane lookup without renaming a tab", async (t) => {
  const h = harness(t);
  h.setPaneOutput(pane(26, "shell"));
  const held = h.hold((_command, args) => args[1] === "list-panes");
  h.fire("session_start");
  await held.entered.promise;
  await h.fire("session_shutdown");
  assert.equal(h.abortedCommands(), 1);
  assert.deepEqual(h.writes, []);
  assert.equal(h.pipes.at(-1)?.kind, "remove");
});

test("binding: moved panes clear completion only on their new tab", async (t) => {
  const h = harness(t, { seenPollFirstDelayMs: 5 });
  await h.start();
  await h.tick(31_000);
  h.moveTo(27);
  await h.emit("agent_settled");
  h.setTabOutput(JSON.stringify([
    { tab_id: 26, name: "Old explicit name", active: true },
    { tab_id: 27, name: "New explicit name", active: false },
  ]));
  await h.tick(5);
  assert.equal(h.pipes.at(-1).mode, "done");
  h.setTabOutput(JSON.stringify([{ tab_id: 27, name: "New explicit name", active: true }]));
  await h.tick(10);
  assert.equal(h.pipes.at(-1).mode, "base");
  assert.deepEqual(h.writes, []);
});

test("binding: a superseding state cancels obsolete discovery without a title write", async (t) => {
  const h = harness(t);
  await h.start();
  await h.tick(31_000);
  const held = h.hold((_command, args) => args[1] === "list-tabs");
  h.fire("agent_settled");
  await held.entered.promise;
  h.fire("agent_start");
  held.release.resolve();
  await flush();
  assert.deepEqual(h.writes, []);
  assert.equal(h.pipes.at(-1)?.mode, "working");
});
