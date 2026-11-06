import { required } from "./helpers/guards.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { widgetUI } from "../lib/host.ts";
import { createStableWidget } from "../lib/stable-widget.ts";
import { createWidgetHost } from "./widget-host.ts";

test("retained widgets update factories and lines without re-registering, and dispose on real removal", () => {
  const h = createWidgetHost();
  const ui = { setWidget: h.setWidget };
  const set = createStableWidget();
  let disposed = 0;
  let invalidated = 0;
  const factory = (text: string) => () => ({
    render: (width: number) => [text.slice(0, width)],
    invalidate() { invalidated++; },
    dispose() { disposed++; },
  });
  set(undefined, "panel", ["headless"]);
  set(widgetUI({}), "panel", ["missing API"]);
  set(ui, "panel", factory("waiting"));
  const mounted = required(h.widgets.get("panel"));
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
  assert.equal(required(required(h.registrations.at(-1)).options).placement, "belowEditor");
  assert.notEqual(h.widgets.get("panel"), mounted);
  const replacement = required(h.widgets.get("panel"));
  const dispose = required(replacement.dispose);
  dispose();
  dispose();
  assert.equal(disposed, 3);
  set(ui, "panel", ["new session"]);
  assert.match(required(h.widgets.get("panel")).render(80).join(" "), /new session/);
  set(ui, "panel", undefined);
  assert.equal(h.widgets.has("panel"), false);
});
