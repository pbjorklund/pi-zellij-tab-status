import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function isInteractiveZellij(ctx: Pick<ExtensionContext, "hasUI" | "mode">): boolean {
  return ctx.mode === "tui" && ctx.hasUI && Boolean(process.env.ZELLIJ);
}
