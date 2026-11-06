import { required } from "./helpers/guards.ts";
import { createWidgetHost } from "./widget-host.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { StatusContext, StatusHandler } from "../lib/host.ts";
import type { WidgetUI } from "../lib/stable-widget.ts";
import extension from "../pi-extension.ts";
import { harness } from "./helpers/lifecycle.ts";

test("unavailable Zellij stays hidden without initializing or probing integration", async (t) => {
  const old = process.env.ZELLIJ;
  delete process.env.ZELLIJ;
  t.after(() => { if (old === undefined) delete process.env.ZELLIJ; else process.env.ZELLIJ = old; });
  const handlers = new Map<string, StatusHandler>();
  extension({ on: (name, fn) => handlers.set(name, fn) }, new Proxy({}, { get() { assert.fail("no controller when unavailable"); } }));
  const widgets = new Map([["watcher:af-watch-project-task", ["Task watcher: idle"]], ["utility", ["Utility: on"]]]);
  const setWidget: WidgetUI["setWidget"] = (key, value) => { assert.ok(value === undefined || Array.isArray(value)); if (value === undefined) widgets.delete(key); else widgets.set(key, value); };
  const ctx: StatusContext = { cwd: "/repo", sessionManager: { getSessionId: () => "test" }, hasUI: true, mode: "tui", ui: { setWidget } };
  await required(handlers.get("session_start"))({}, ctx);
  assert.equal(widgets.has("pi-zellij-tab-status"), false);
  await required(handlers.get("session_shutdown"))({}, ctx);
  assert.deepEqual([...widgets.keys()], ["watcher:af-watch-project-task", "utility"]);
  const modes: StatusContext["mode"][] = ["rpc", "json", "print", undefined];
  for (const mode of modes) {
    await required(handlers.get("session_start"))({}, { ...ctx, mode, ui: { setWidget() { assert.fail("terminal UI in non-TUI mode"); } } });
  }
  await required(handlers.get("session_start"))({}, { ...ctx, hasUI: false });
  await required(handlers.get("session_start"))({}, { ...ctx, ui: {} });
});

test("available bar follows activity without adding Zellij work and ignores late events", async (t) => {
  const widgets = new Map([["utility", ["Utility: on"]]]);
  const h = harness(t, { ctx: { ui: { setWidget: createWidgetHost((key, value) => value === undefined ? widgets.delete(key) : widgets.set(key, value)).setWidget } } });
  await h.emit("session_start");
  assert.equal(widgets.has("pi-zellij-tab-status"), false);
  await h.emit("agent_start");
  assert.match(required(widgets.get("pi-zellij-tab-status")).join(" "), /working/);
  await h.emit("session_before_compact");
  assert.match(required(widgets.get("pi-zellij-tab-status")).join(" "), /compacting/);
  await h.emit("session_compact_failed");
  await h.emit("agent_settled");
  assert.equal(widgets.has("pi-zellij-tab-status"), false);
  await h.emit("subagents:started", { id: "one" });
  await h.emit("subagents:started", { id: "two" });
  await h.emit("subagents:completed", { id: "one" });
  assert.match(required(widgets.get("pi-zellij-tab-status")).join(" "), /working/);
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
