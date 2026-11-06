import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WidgetUI } from "./stable-widget.ts";

function hasWidgetUI(ui: Partial<WidgetUI> | undefined): ui is WidgetUI {
  return typeof ui?.setWidget === "function";
}
export function widgetUI(ui: Partial<WidgetUI> | undefined): WidgetUI | undefined {
  return hasWidgetUI(ui) ? ui : undefined;
}

// Only capabilities used by this extension are required from the host.
export type StatusContext = Pick<ExtensionContext, "cwd" | "hasUI"> & {
  mode?: ExtensionContext["mode"];
  sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionId">;
  ui?: Partial<WidgetUI>;
};
export type StatusHandler = (event: unknown, ctx: StatusContext) => void | Promise<void>;
export type StatusEvent = "session_start" | "session_shutdown" | "agent_start" | "agent_settled" |
  "session_before_compact" | "session_compact" | "session_compact_failed" | "input";
export type StatusHost = {
  on(name: StatusEvent, handler: StatusHandler): unknown;
  events?: { on(name: string, handler: (event: unknown) => void): unknown };
};
