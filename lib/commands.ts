import { execFile, spawn, type ChildProcess, type ExecFileOptions, type SpawnOptions } from "node:child_process";
import { promisify } from "node:util";

export type ExecFileAsyncFn = (command: string, args: string[], options: ExecFileOptions) => Promise<{ stdout: string }>;
export const defaultExecFileAsync: ExecFileAsyncFn = promisify(execFile);
export type SpawnIgnoredFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => {
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill: ChildProcess["kill"];
  unref: ChildProcess["unref"];
};
export const defaultSpawnIgnored: SpawnIgnoredFn = spawn;
const COMMAND_TIMEOUT_MS = 2_000;
const PIPE_TIMEOUT_MS = 150;

export function runIgnoredCommand(
  spawnIgnored: SpawnIgnoredFn,
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnIgnored(command, args, { stdio: "ignore", windowsHide: true });
    child.unref();
    let settled = false;
    let timedOut = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? PIPE_TIMEOUT_MS);
    child.once("error", finish);
    child.once("close", (code, signal) => {
      if (timedOut) finish(new Error(`${command} timed out`));
      else if (code === 0) finish();
      else finish(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}`));
    });
  });
}

export async function runCommand(
  execFileAsync: ExecFileAsyncFn,
  command: string,
  args: string[],
  options: { cwd?: string } = {},
) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}
