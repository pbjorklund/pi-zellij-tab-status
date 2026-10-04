# pi-zellij-tab-status

A PI extension that publishes agent state to the `zellij-tabbar` vertical sidebar.

While PI works, the sidebar shows an animated spinner beside the owning tab. When a background run settles, it shows `●` until you view that tab. The extension only publishes pane-scoped PI status. The sidebar owns automatic tab naming and renders spinner frames without renaming tabs.

Use it when PI runs inside Zellij with the matching custom vertical sidebar and background completion should stay visible across tabs. Do not use it outside a supported PI TUI, as a job audit log, or with Zellij's built-in tab bar when status markers are required.

## Install

Install the matching [zellij-tabbar](https://github.com/pbjorklund/zellij-tabbar) WASM and layout first. Then add this Git package to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "git:github.com/pbjorklund/pi-zellij-tab-status"
  ]
}
```

Run `pi update` or restart PI and approve package installation when prompted. No config file is required. `PI_SUBAGENT_ZELLIJ_PLACEMENT` belongs to `pi-subagents`, not this status extension.

Update with `pi update git:github.com/pbjorklund/pi-zellij-tab-status`, then reload PI. Remove the package with `pi remove git:github.com/pbjorklund/pi-zellij-tab-status`; remove the matching sidebar separately if nothing else uses it.

## Behavior

- Runs only in PI's TUI inside Zellij.
- Sends a complete `pi_status` snapshot when state changes, then replays the same active snapshot every five seconds so newly loaded sidebars catch up. It sends no animation frames.
- Uses the stable Zellij pane ID, a runtime ID, and a monotonic sequence so moved panes and stale updates remain distinguishable.
- Keeps the parent and tracked subagent state working until all work settles.
- Keeps work marked across automatic retries, queued follow-ups, and compaction recovery.
- Publishes `compacting` during manual and automatic compaction, then restores the effective state after success, failure, or cancellation.
- Publishes `done` once the parent has settled and all tracked subagents have finished. The visible sidebar clears it immediately; the extension confirms tab visibility with bounded backoff and publishes `base` so every sidebar instance converges.
- Publishes optional watcher letters in compatible `CIPRS` order: checklist `C`, improvement `I`, project tasks `P`, GitHub review `R`, and Sentry `S`. The sidebar displays only `CIRS`, as a prefix before the spinner or unseen-completion marker, for example `CIRS⠹ app` or `I● app`. A letter means non-off: polling, queued, working, waiting, paused, or error. Idle tabs keep their letters; letters do not imply agent work. Project-task `P` remains in the payload but is not shown. The spinner and unseen-completion marker remain independent. Canonical `watcher:af-watch-*` and `watcher:watch-*` events take precedence over legacy `watcher:cw/iw/pw/rw/sw` events for each letter; a canonical `off` stops stale legacy events from reviving a marker during rollout.
- Publishes a runtime-specific removal during shutdown.
- Never renames tabs, including at startup, settlement, and exit. Explicit user names stay intact. The sidebar owns automatic names from native pane cwd labels, without Git branch inference.
- Coalesces event bursts and treats Zellij commands as best effort, so status failures do not block PI lifecycle hooks.

Subagent tracking supports both the `subagents:started` / `subagents:completed` / `subagents:failed` event bus (payload: `{ id }`) and the `@narumitw/pi-subagents` named-agent tools (`subagent`, `subagent_resume`, and `subagent_kill`). It reads new `subagent_result` entries from in-memory session history every 500 ms while agents are active. This catches asynchronous completions while the parent is idle without reading session files or spawning status-frame processes.

The extension needs PI 0.87.0 or newer and a Zellij version that provides `list-panes`, `list-tabs`, and `pipe`. Status markers require the matching custom sidebar; Zellij's built-in horizontal tab bar keeps its normal name but does not show PI status.

## Status protocol

The extension broadcasts version 1 JSON through `zellij pipe --name pi_status`. A snapshot has this shape:

```json
{
  "v": 1,
  "kind": "snapshot",
  "runtime_id": "2b73...",
  "seq": 4,
  "pane_id": 248,
  "mode": "working"
}
```

`mode` is `base`, `working`, `compacting`, or `done`. An optional `watchers` string holds non-off letters in `CIPRS` order; it is omitted when no watcher is enabled. The sidebar renders `CIRS` before the status marker and name, within the name's display-column budget. It takes the first non-plugin pane with status in the tab's pane manifest, not a union of all panes' watcher letters. Viewing the tab clears completion without clearing watchers. Snapshots with active work, unseen completion, or watchers are replayed with the same sequence number; existing sidebars ignore the duplicate while new sidebars accept it. Shutdown sends `kind: "remove"` with the same identity fields and no mode, clearing that runtime's status and watchers. Abrupt crashes have no promised status expiry. Messages contain no prompt, command, cwd, tool argument, or conversation content.

## Development

Run the deterministic regression suite:

```bash
npm test
npm run test:coverage
npm run eval
```

CI enforces at least 95% aggregate line, branch, and function coverage across `pi-extension.ts` and `lib/*.ts`. The eval wrapper runs every test file, records no model output, and makes no network calls. Keep the status protocol synchronized with `zellij-tabbar` when changing message fields or lifecycle semantics.

### Live smoke and E2E tests

On Linux, install PI, Zellij, Node.js 24+, Python 3, Git, and util-linux's `script` command, then run:

```bash
npm run test:smoke
npm run test:e2e
```

Each test starts a real PI TUI in a separate Zellij session with temporary configuration and no inherited credentials. These extension tests verify lifecycle handling, successful pipe publication, explicit user names surviving PI start, work, settlement, and exit, and cleanup. The `zellij-tabbar` repository's isolated live smoke test verifies exact watcher prefixes, idle/off/removal behavior, local animation, background completion, and clearing on view without losing watchers with the real WASM plugin. That suite requires the parked-tab Zellij fork; native Zellij 0.45.1 lacks `ParkTab`. It leaves existing sessions and installed plugins untouched.

### Structure

- `pi-extension.ts` registers lifecycle handlers.
- `controller.ts` coalesces lifecycle changes, replays active status for new sidebars, and orders shutdown.
- `tab-binding.ts` owns binding retries and caching for completion visibility checks.
- `ownership.ts` parses pane/tab data and selects the owner. `zellij.ts` only reads Zellij state.
- `activity.ts` owns parent, child, and compaction transitions. `subagent-jobs.ts` adapts named-agent results and reads idle completions.
- `status-model.ts` retains marker parsing compatibility for old titles; `tab-title.ts` retains exported Git/directory title helpers for compatibility, unused by the extension lifecycle. `commands.ts` keeps stdout-reading commands captured, while `status-transport.ts` serializes status pipes with ignored stdio and a 150 ms deadline.

## License

MIT
