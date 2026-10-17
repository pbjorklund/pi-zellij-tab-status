import test from "node:test";
import assert from "node:assert/strict";
import extension from "../pi-extension.ts";
import { harness } from "./helpers/lifecycle.mjs";

test("unavailable Zellij stays hidden without initializing or probing integration", async (t) => {
  const old = process.env.ZELLIJ;
  delete process.env.ZELLIJ;
  t.after(() => { if (old === undefined) delete process.env.ZELLIJ; else process.env.ZELLIJ = old; });
  const handlers = new Map();
  extension({ on: (name, fn) => handlers.set(name, fn) }, new Proxy({}, { get() { assert.fail("no controller when unavailable"); } }));
  const widgets = new Map([["watcher:af-watch-project-task", ["Task watcher: idle"]], ["utility", ["Utility: on"]]]);
  const ctx = { hasUI: true, mode: "tui", ui: { setWidget: (key, value) => value === undefined ? widgets.delete(key) : widgets.set(key, value) } };
  await handlers.get("session_start")({}, ctx);
  assert.equal(widgets.has("pi-zellij-tab-status"), false);
  await handlers.get("session_shutdown")({}, ctx);
  assert.deepEqual([...widgets.keys()], ["watcher:af-watch-project-task", "utility"]);
  for (const mode of ["rpc", "json", "print", undefined]) {
    await handlers.get("session_start")({}, { ...ctx, mode, ui: { setWidget() { assert.fail("terminal UI in non-TUI mode"); } } });
  }
  await handlers.get("session_start")({}, { ...ctx, hasUI: false });
  await handlers.get("session_start")({}, { ...ctx, ui: {} });
});

test("available bar follows activity without adding Zellij work and ignores late events", async (t) => {
  const widgets = new Map([["utility", ["Utility: on"]]]);
  const h = harness(t, { ctx: { ui: { setWidget: (key, value) => value === undefined ? widgets.delete(key) : widgets.set(key, value) } } });
  await h.emit("session_start");
  assert.equal(widgets.has("pi-zellij-tab-status"), false);
  await h.emit("agent_start");
  assert.match(widgets.get("pi-zellij-tab-status").join(" "), /working/);
  await h.emit("session_before_compact");
  assert.match(widgets.get("pi-zellij-tab-status").join(" "), /compacting/);
  await h.emit("session_compact_failed");
  await h.emit("agent_settled");
  assert.equal(widgets.has("pi-zellij-tab-status"), false);
  await h.emit("subagents:started", { id: "one" });
  await h.emit("subagents:started", { id: "two" });
  await h.emit("subagents:completed", { id: "one" });
  assert.match(widgets.get("pi-zellij-tab-status").join(" "), /working/);
  await h.emit("subagents:failed", { id: "two" });
  assert.equal(widgets.has("pi-zellij-tab-status"), false);
  assert.equal(h.writes.length, 0);
  await h.emit("session_shutdown");
  await h.emit("subagents:started", { id: "late-private-id" });
  await h.emit("agent_start");
  assert.deepEqual([...widgets.keys()], ["utility"]);
});

test("Zellij environment without a pane identity stays hidden even during work", async (t) => {
  let bar;
  const h = harness(t, { ctx: { ui: { setWidget: (_key, value) => { bar = value; } } } });
  process.env.ZELLIJ_PANE_ID = "";
  await h.emit("session_start");
  assert.equal(bar, undefined);
  await h.emit("agent_start");
  assert.equal(bar, undefined);
});
