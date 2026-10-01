import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runCommand, type ExecFileAsyncFn } from "./commands.ts";
import { parsePaneList, parseTabList, selectOwningPane, type ZellijTabInfo } from "./ownership.ts";

export type OwningTabInfo = ZellijTabInfo & { paneCwd: string | null };

export async function readOwningTabWith(
  exec: ExecFileAsyncFn,
  ctx: Pick<ExtensionContext, "cwd">,
): Promise<OwningTabInfo | null> {
  try {
    const [{ stdout: panesStdout }, tabsResult] = await Promise.all([
      runCommand(exec, "zellij", ["action", "list-panes", "--all", "--json", "--command", "--state"]),
      runCommand(exec, "zellij", ["action", "list-tabs", "--json", "--state"]).catch(() => ({ stdout: "[]" })),
    ]);
    const pane = selectOwningPane(
      parsePaneList(panesStdout),
      parseTabList(tabsResult.stdout),
      ctx.cwd,
      process.env.ZELLIJ_PANE_ID,
    );
    if (!pane) return null;
    return { tabId: pane.tabId, name: pane.tabName, active: false, paneCwd: pane.paneCwd };
  } catch {
    return null;
  }
}

export async function readTabByIdWith(exec: ExecFileAsyncFn, tabId: string): Promise<ZellijTabInfo | null> {
  try {
    const { stdout } = await runCommand(exec, "zellij", ["action", "list-tabs", "--json", "--state"]);
    return parseTabList(stdout).find((tab) => tab.tabId === tabId) ?? null;
  } catch {
    return null;
  }
}
