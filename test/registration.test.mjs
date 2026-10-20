import test from "node:test";
import assert from "node:assert/strict";
import extension from "../pi-extension.ts";
import { harness } from "./helpers/lifecycle.mjs";

for (const zellij of [undefined, ""]) {
  test(`registers only passive bar lifecycle outside Zellij (${zellij === undefined ? "unset" : "empty"})`, (t) => {
    const oldEnv = { ZELLIJ: process.env.ZELLIJ, ZELLIJ_PANE_ID: process.env.ZELLIJ_PANE_ID };
    t.after(() => {
      for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    if (zellij === undefined) delete process.env.ZELLIJ;
    else process.env.ZELLIJ = zellij;
    process.env.ZELLIJ_PANE_ID = "248";
    const registrations = [];
    const options = new Proxy({}, {
      get() { assert.fail("inactive extension must not initialize the controller"); },
    });

    extension({
      on: (name) => registrations.push(name),
      events: { on: (name) => registrations.push(name) },
    }, options);

    assert.deepEqual(registrations, ["session_start", "session_shutdown"]);
  });
}

test("registers lifecycle and event-bus integration inside Zellij", async (t) => {
  const h = harness(t);
  for (const event of ["session_start", "agent_start", "agent_settled", "session_shutdown",
    "watcher:status", "subagents:work", "subagents:started", "subagents:completed", "subagents:failed"]) {
    assert.equal(h.hasHandler(event), true, event);
  }
  await h.start();
  assert.equal(h.pipes.at(-1).mode, "working");
  await h.emit("agent_settled");
  assert.equal(h.pipes.at(-1).mode, "done");
});
