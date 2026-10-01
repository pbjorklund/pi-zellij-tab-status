import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExecFileAsyncFn } from "./commands.ts";
import { pathsMatch } from "./ownership.ts";
import { readOwningTabWith, readTabByIdWith } from "./zellij.ts";

const VALIDATION_TTL_MS = 5_000;
const BIND_RETRY_ATTEMPTS = 20;

export type TabBinding = {
  tabId: string;
  cwd: string;
  validatedAt: number;
};

export function createTabBinding(
  exec: ExecFileAsyncFn,
  now: () => number,
  retryDelay: () => Promise<void>,
) {
  let binding: TabBinding | null = null;

  async function ensure(ctx: ExtensionContext, valid: () => boolean) {
    if (binding && pathsMatch(binding.cwd, ctx.cwd) && now() - binding.validatedAt < VALIDATION_TTL_MS) return binding;

    for (let attempt = 0; attempt < BIND_RETRY_ATTEMPTS && valid(); attempt++) {
      const owner = await readOwningTabWith(exec, ctx);
      if (!valid()) return null;
      if (owner) {
        if (binding?.tabId === owner.tabId && pathsMatch(owner.paneCwd, binding.cwd)) {
          binding.validatedAt = now();
          return binding;
        }
        const cwd = owner.paneCwd ?? ctx.cwd;
        binding = { tabId: owner.tabId, cwd, validatedAt: now() };
        return binding;
      }
      if (binding && pathsMatch(binding.cwd, ctx.cwd)) {
        const tab = await readTabByIdWith(exec, binding.tabId);
        if (!valid()) return null;
        if (tab) {
          binding.validatedAt = now();
          return binding;
        }
      }
      binding = null;
      if (attempt < BIND_RETRY_ATTEMPTS - 1) await retryDelay();
    }
    return null;
  }

  return {
    current: () => binding,
    ensure,
    clear() {
      binding = null;
    },
  };
}
