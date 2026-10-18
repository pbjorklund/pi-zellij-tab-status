import assert from "node:assert/strict";
import test from "node:test";
import { createStableWidget } from "../lib/stable-widget.ts";
import { createWidgetHost } from "./widget-host.mjs";

test("retained widgets update factories and lines without re-registering, and dispose on real removal", () => {
  const h = createWidgetHost();
  const ui = { setWidget: h.setWidget };
  const set = createStableWidget();
  let disposed = 0;
  let invalidated = 0;
  const factory = text => () => ({
    render: width => [text.slice(0, width)],
    invalidate() { invalidated++; },
    dispose() { disposed++; },
  });
  set(undefined, "panel", ["headless"]);
  set({}, "panel", ["missing API"]);
  set(ui, "panel", factory("waiting"));
  const mounted = h.widgets.get("panel");
  set(ui, "panel", factory("working"));
  assert.equal(h.widgets.get("panel"), mounted);
  assert.deepEqual(mounted.render(4), ["work"]);
  assert.equal(disposed, 1);
  mounted.invalidate();
  assert.equal(invalidated, 2);
  const rows = ["first"];
  set(ui, "panel", rows);
  assert.equal(disposed, 2);
  set(ui, "panel", [...rows]);
  assert.equal(h.registrations.length, 1);
  rows[0] = "updated";
  set(ui, "panel", rows);
  assert.match(mounted.render(80).join(" "), /updated/);
  set(ui, "panel", Array.from({ length: 11 }, (_, i) => `row ${i}`));
  assert.match(mounted.render(80).join(" "), /widget truncated/);
  set(ui, "panel", factory("ready"), { placement: "belowEditor" });
  assert.equal(h.registrations.at(-1).options.placement, "belowEditor");
  assert.notEqual(h.widgets.get("panel"), mounted);
  const replacement = h.widgets.get("panel");
  replacement.dispose();
  replacement.dispose();
  assert.equal(disposed, 3);
  set(ui, "panel", ["new session"]);
  assert.match(h.widgets.get("panel").render(80).join(" "), /new session/);
  set(ui, "panel", undefined);
  assert.equal(h.widgets.has("panel"), false);
});
