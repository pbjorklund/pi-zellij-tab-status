import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { TestContext } from "node:test";
import type { SpawnOptions } from "node:child_process";
import type { StatusContext, StatusHandler } from "../../lib/host.ts";
import type { ZellijTabStatusOptions } from "../../pi-extension.ts";
import { statusMessage, required, type StatusMessage } from "./guards.ts";
import extension from "../../pi-extension.ts";

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve: () => void = () => { throw new Error("deferred not initialized"); };
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type Match = (command: string, args: string[]) => boolean;
type Gate = { matches: Match; entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
type Options = ZellijTabStatusOptions & { ctx?: Partial<StatusContext> };
export function harness(t: TestContext, options: Options = {}) {
  const oldEnv = { ZELLIJ: process.env.ZELLIJ, ZELLIJ_PANE_ID: process.env.ZELLIJ_PANE_ID };
  process.env.ZELLIJ = "0";
  process.env.ZELLIJ_PANE_ID = "248";
  t.after(() => {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const handlers = new Map<string, StatusHandler>();
  const calls: { command: string; args: string[]; options: SpawnOptions; at: number }[] = [];
  const writes: { tabId: string; name: string }[] = [];
  const pipes: StatusMessage[] = [];
  let tabId = 26;
  let branch = "main";
  let active = false;
  let paneOutput: string | undefined;
  let tabOutput: string | undefined;
  let renameFailures = 0;
  let pipeFailures = 0;
  let gate: Gate | undefined;
  const heldCommands: Gate[] = [];
  const entries = new Map<string, Record<string, unknown>>();
  let leaf: string | null = null;
  let entryReads = 0;
  let abortedCommands = 0;
  const sessionManager = {
    getSessionId: () => "session-one",
    getLeafId: () => leaf,
    getEntry: (id: string) => { entryReads++; return entries.get(id); },
  };
  const ctx: StatusContext = { cwd: "/repo", mode: "tui", hasUI: true, sessionManager, ...options.ctx };
  extension({
    on: (name, handler) => handlers.set(name, handler),
    events: { on: (name, handler) => handlers.set(name, handler) },
  }, {
    statusReplayIntervalMs: options.statusReplayIntervalMs,
    seenPollFirstDelayMs: options.seenPollFirstDelayMs,
    now: options.now,
    runtimeId: options.runtimeId,
    spawnIgnored: (command, args, execOptions) => {
      const child = Object.assign(new EventEmitter(), { unref() {}, kill() { return true; } });
      calls.push({ command, args, options: execOptions, at: Date.now() });
      queueMicrotask(async () => {
        if (gate?.matches(command, args)) {
          const current = gate;
          gate = undefined;
          current.entered.resolve();
          await current.release.promise;
        }
        if (pipeFailures > 0) {
          pipeFailures--;
          child.emit("error", new Error("pipe failed"));
          return;
        }
        pipes.push(statusMessage(required(args.at(-1))));
        child.emit("close", 0, null);
      });
      return child;
    },
    execFileAsync: async (command, args, execOptions) => {
      calls.push({ command, args, options: execOptions, at: Date.now() });
      if (gate?.matches(command, args)) {
        const current = gate;
        gate = undefined;
        current.entered.resolve();
        await Promise.race([
          current.release.promise,
          new Promise((_, reject) => execOptions.signal?.addEventListener(
            "abort",
            () => {
              abortedCommands++;
              reject(new Error("command aborted"));
            },
            { once: true },
          )),
        ]);
      }
      if (command === "git") {
        if (args[0] === "rev-parse") {
          if (args[1] === "--show-toplevel") return { stdout: "/repo" };
          if (args[1] === "--show-prefix") return { stdout: "" };
          if (args[1] === "--short") return { stdout: branch };
        }
        assert.equal(args[0], "symbolic-ref");
        return { stdout: branch };
      }
      assert.equal(command, "zellij");
      if (args[1] === "list-panes") return { stdout: paneOutput ?? JSON.stringify([
        { id: 248, tab_id: tabId, tab_name: "repo:main", pane_cwd: "/repo", pane_command: "pi" },
      ]) };
      if (args[1] === "list-tabs") return { stdout: tabOutput ?? JSON.stringify([
        { tab_id: tabId, name: "repo:main", active },
      ]) };
      assert.equal(args[1], "rename-tab-by-id");
      if (renameFailures > 0) {
        renameFailures--;
        throw new Error("rename failed");
      }
      writes.push({ tabId: args[2], name: args[3] });
      return { stdout: "" };
    },
  });
  const fire = (name: string, event: unknown = {}) => {
    const handler = handlers.get(name);
    assert.ok(handler, `missing handler for ${name}`);
    return handler(event, ctx);
  };
  t.after(async () => {
    for (const held of heldCommands) held.release.resolve();
    await fire("session_shutdown");
  });
  return {
    fire, calls, writes, pipes,
    hasHandler: (name: string) => handlers.has(name),
    async emit(name: string, event: unknown = {}) { await fire(name, event); await flush(); },
    entryReads: () => entryReads,
    abortedCommands: () => abortedCommands,
    appendEntry(entry: Record<string, unknown>) {
      const id = `entry-${entries.size}`;
      entries.set(id, { ...entry, id, parentId: leaf });
      leaf = id;
    },
    async start() { fire("session_start"); await flush(); fire("agent_start"); await flush(); },
    async tick(ms: number) { t.mock.timers.tick(ms); await flush(); },
    setActive(value: boolean) { active = value; },
    setBranch(value: string) { branch = value; },
    moveTo(value: number) { tabId = value; },
    setPaneOutput(value: string) { paneOutput = value; },
    setTabOutput(value: string) { tabOutput = value; },
    failRenames(count: number) { renameFailures = count; },
    failPipes(count: number) { pipeFailures = count; },
    hold(matches: Match) {
      const held = { matches, entered: deferred(), release: deferred() };
      gate = held;
      heldCommands.push(held);
      return held;
    },
  };
}
