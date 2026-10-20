import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isInteractiveZellij } from "./status-model.ts";

type WorkSnapshot = { sessionId: string; count: number };

export function createSubagentJobObserver(
  onChange: (count: number, ctx: ExtensionContext) => void,
) {
  let ctx: ExtensionContext | null = null;
  let latest: WorkSnapshot | undefined;
  let count = 0;
  let closed = false;

  function apply() {
    if (!ctx || !isInteractiveZellij(ctx) || latest?.sessionId !== ctx.sessionManager.getSessionId() || latest.count === count) return;
    count = latest.count;
    onChange(count, ctx);
  }

  return {
    start(context: ExtensionContext) {
      ctx = context;
      count = 0;
      apply();
    },
    update(value: unknown) {
      if (closed || !value || typeof value !== "object" || Array.isArray(value)) return;
      const snapshot = value as { sessionId?: unknown; count?: unknown };
      if (typeof snapshot.sessionId !== "string" || !snapshot.sessionId.trim() ||
        typeof snapshot.count !== "number" || !Number.isSafeInteger(snapshot.count) || snapshot.count < 0) return;
      if (ctx && snapshot.sessionId !== ctx.sessionManager.getSessionId()) return;
      latest = { sessionId: snapshot.sessionId, count: snapshot.count };
      apply();
    },
    close() {
      closed = true;
      ctx = null;
      latest = undefined;
      count = 0;
    },
  };
}
