import { createStableWidget } from "./lib/stable-widget.ts";
import { widgetUI, type StatusHost, type StatusContext } from "./lib/host.ts";
import { createTabStatusController, type ZellijTabStatusOptions, type WatcherDetail, type WatcherStates } from "./lib/controller.ts";
import { createActivityState, parseSubagentId, type TabMode } from "./lib/activity.ts";
import { createSubagentJobObserver } from "./lib/subagent-jobs.ts";
import { createTintinObserver } from "./lib/tintin.ts";

export type { ZellijTabStatusOptions } from "./lib/controller.ts";
export type { ZellijTabInfo } from "./lib/ownership.ts";
export { parseTabInfo, parseTabList, parsePaneInfo, parsePaneList, selectOwningPane } from "./lib/ownership.ts";
export { isInteractiveZellij } from "./lib/status-model.ts";
export { parseSubagentId, createWorkTracker } from "./lib/activity.ts";

const WATCHERS: readonly (readonly [string, string])[] = [
  ["C", "watcher:af-watch-checklist"],
  ["I", "watcher:af-watch-improvement"],
  ["P", "watcher:af-watch-project-task"],
  ["R", "watcher:watch-github-pr"],
  ["S", "watcher:watch-sentry"],
];

export default function zellijPiTabStatus(pi: StatusHost, options: ZellijTabStatusOptions = {}) {
  const setWidget = createStableWidget();
  let barCtx: StatusContext | undefined;
  const widget = (ctx: StatusContext, mode?: TabMode) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const pane = Number(process.env.ZELLIJ_PANE_ID);
    const visible = process.env.ZELLIJ && process.env.ZELLIJ_PANE_ID?.trim() && Number.isSafeInteger(pane) && pane >= 0
      && (mode === "working" || mode === "compacting");
    setWidget(widgetUI(ctx.ui), "pi-zellij-tab-status", visible ? [`Zellij: ${mode}`] : undefined);
  };
  const clearBar = () => {
    if (barCtx?.mode === "tui" && barCtx.hasUI) setWidget(widgetUI(barCtx.ui), "pi-zellij-tab-status", undefined);
    barCtx = undefined;
  };
  const startBar = (ctx: StatusContext) => {
    clearBar();
    barCtx = ctx;
    widget(ctx, "base");
  };
  if (!process.env.ZELLIJ) {
    pi.on("session_start", (_event, ctx) => startBar(ctx));
    pi.on("session_shutdown", clearBar);
    return;
  }

  const controller = createTabStatusController(options);
  const activity = createActivityState();
  let currentCtx: StatusContext | null = null;
  let closed = false;
  const watcherStatuses = new Map<string, WatcherDetail>();

  pi.events?.on?.("watcher:status", (data: unknown) => {
    if (closed || !data || typeof data !== "object") return;
    if (!("key" in data) || !("status" in data)) return;
    const { key, status } = data;
    const waitingKind = "waitingKind" in data ? data.waitingKind : undefined;
    if (typeof key !== "string" || !WATCHERS.some(([, canonical]) => canonical === key) ||
      (status !== "off" && status !== "polling" && status !== "queued" && status !== "working" &&
        status !== "waiting" && status !== "paused" && status !== "error")) return;
    const detailValue: WatcherDetail = { status };
    if (status === "waiting") detailValue.waiting_kind = waitingKind === "human" ? "human" : "other";
    watcherStatuses.set(key, detailValue);
    const detail: WatcherStates = {};
    for (const [letter, canonical] of WATCHERS) {
      const value = watcherStatuses.get(canonical);
      if (value && value.status !== "off") detail[letter] = value;
    }
    const letters = Object.keys(detail).join("");
    controller.setWatchers(currentCtx, letters, detail);
  });

  function showActivity(ctx: StatusContext, mode: TabMode) {
    if (closed) return;
    widget(ctx, mode);
    currentCtx = ctx;
    controller.setMode(ctx, mode);
  }

  const jobs = createSubagentJobObserver((count, ctx) => {
    showActivity(ctx, activity.setDelegatedWork(count));
  });
  pi.events?.on?.("subagents:work", (snapshot) => jobs.update(snapshot));
  const tintin = createTintinObserver((working) => {
    const mode = activity.setProviderRunning(working);
    if (currentCtx) showActivity(currentCtx, mode);
  });
  pi.events?.on?.("subagents:created", (event) => {
    const id = parseSubagentId(event);
    if (!closed && currentCtx && id) tintin.observe(id);
  });

  pi.on("session_start", (_event, ctx) => {
    startBar(ctx);
    tintin.reset();
    activity.reset();
    currentCtx = ctx;
    jobs.start(ctx);
    showActivity(ctx, activity.mode());
  });
  pi.on("agent_start", (_event, ctx) => showActivity(ctx, activity.startParent()));
  // agent_end can precede retries and queued follow-ups. Only settlement
  // ends the parent's working span.
  pi.on("agent_settled", (_event, ctx) => {
    tintin.refresh();
    showActivity(ctx, activity.settleParent());
  });
  pi.on("session_before_compact", (_event, ctx) => showActivity(ctx, activity.startCompaction()));
  const finishCompacting = (_event: unknown, ctx: StatusContext) => showActivity(ctx, activity.finishCompaction());
  pi.on("session_compact", finishCompacting);
  pi.on("session_compact_failed", finishCompacting);

  pi.events?.on?.("subagents:started", (event) => {
    const id = parseSubagentId(event);
    if (closed || !id) return;
    if (currentCtx) tintin.observe(id);
    const mode = activity.startChild(id);
    if (currentCtx) showActivity(currentCtx, mode);
  });
  for (const event of ["subagents:completed", "subagents:failed"]) {
    pi.events?.on?.(event, (data) => {
      const id = parseSubagentId(data);
      if (closed || !id) return;
      tintin.terminal(id);
      if (!activity.hasActiveWork()) return;
      const mode = activity.finishChild(id);
      if (currentCtx) showActivity(currentCtx, mode);
    });
  }

  pi.on("input", (event, ctx) => {
    currentCtx = ctx;
    if (!(event && typeof event === "object" && "source" in event && event.source === "extension") &&
      !activity.hasActiveWork()) controller.clearDone(ctx);
  });
  pi.on("session_shutdown", () => {
    clearBar();
    closed = true;
    jobs.close();
    tintin.reset();
    activity.reset();
    currentCtx = null;
    return controller.close();
  });
}
