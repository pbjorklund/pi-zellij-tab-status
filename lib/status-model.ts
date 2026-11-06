import type { StatusContext } from "./host.ts";

export function isInteractiveZellij(ctx: Pick<StatusContext, "hasUI" | "mode">): boolean {
  return ctx.mode === "tui" && ctx.hasUI && Boolean(process.env.ZELLIJ);
}
