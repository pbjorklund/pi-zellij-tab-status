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
- Publishes watcher state for checklist `C`, project tasks `P`, improvement `I`, GitHub review `R`, and Sentry `S`. The sidebar shows compact pairs after the name in `CPIRS` order: `backoffice Ce|Pw` means checklist error and project working. States are `p` polling, `w` working, `e` error, `h` verified human wait, `q` queued, `a` paused, and `t` other waiting. Off watchers are omitted. Spinners and unseen-completion markers remain independent.
- Publishes a runtime-specific removal during shutdown.
- Never renames tabs. Publishes the PI cwd's folder basename so the sidebar can show folder-only automatic labels, including named PI sessions. Explicit Zellij tab names stay intact. No Git branch inference is used.
- Coalesces event bursts and treats Zellij commands as best effort, so status failures do not block PI lifecycle hooks.

Subagent tracking consumes `subagent_activity` custom messages from delegated improvement and Sentry workers (payload details: `{ id, status }`, with `started`, `completed`, `failed`, `timed_out`, or `cancelled`). Worker completion removes only that worker's activity; watcher letters remain independent. It also supports the `subagents:started` / `subagents:completed` / `subagents:failed` event bus (payload: `{ id }`) and the `@narumitw/pi-subagents` named-agent tools (`subagent`, `subagent_resume`, and `subagent_kill`). It reads new `subagent_activity` and `subagent_result` entries from in-memory session history every 500 ms while watchers are enabled or tracked agents are active. This catches asynchronous completions while the parent is idle without reading session files or spawning status-frame processes.

The extension needs PI 0.87.0 or newer and a Zellij version that provides `list-panes`, `list-tabs`, and `pipe`. Status markers require the matching custom sidebar; Zellij's built-in horizontal tab bar keeps its normal name but does not show PI status.

PI's TUI shows the `pi-zellij-tab-status` info bar only during working or compacting activity, including owned delegated work. Idle, done, and unavailable states stay hidden, including outside Zellij or without a usable pane identity. Sidebar completion markers and status publication are unchanged. The bar uses its own widget key, coexists with watcher and utility bars, and clears on shutdown. It adds no Zellij commands, timers, or mutations. RPC, JSON, and print modes do not render it.

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

`mode` is `base`, `working`, `compacting`, or `done`. Optional `folder` holds only the cwd basename, not the full path. Optional `watcher_states` holds validated per-watcher detail, for example `{"C":{"status":"error"},"P":{"status":"waiting","waiting_kind":"human"}}`. Waiting events may supply `waitingKind: "human" | "other"`; absent or invalid evidence means other waiting. No question text is transported.

`watcher_states` is omitted when all watchers are off. The sidebar uses complete `CPIRS` pairs within the display-column budget. Watcher ownership remains the first non-plugin pane with status, not a union of panes. Folder labels use the focused pane's native cwd, with bridge metadata as a fallback. Viewing completion clears its marker without clearing watchers or folder metadata.

All snapshots, including idle folder metadata, replay every five seconds with the same sequence. Existing sidebars ignore duplicates; newly loaded sidebars accept them. Shutdown sends `kind: "remove"` with the same identity fields and no mode. Abrupt crashes have no promised expiry. Messages contain no prompt, command, full cwd path, tool argument, or conversation content.

## Development

Run the deterministic regression suite:

```bash
npm test
npm run test:coverage
npm run eval
```

CI enforces at least 95% aggregate line, branch, and function coverage across `pi-extension.ts` and `lib/*.ts`. The eval wrapper runs every test file, records no model output, and makes no network calls. Keep the status protocol synchronized with `zellij-tabbar` when changing message fields or lifecycle semantics.

### Live smoke and E2E tests

On Linux, install PI, Zellij, Node.js 24+, Python 3, Git, and util-linux's `script` and `flock` commands, then run:

```bash
npm run test:smoke
npm run test:e2e
```

Each test starts a real PI TUI in a separate Zellij session with temporary configuration and no inherited credentials. A per-test lock serializes fixture CLI actions and extension status pipes: concurrent clients can hit Zellij 0.45's client-ID reuse race and falsely report "There is no active session!" while the session remains alive. The attached TUI client stays outside that lock. Failed commands still fail immediately; tests do not retry them. These extension tests verify lifecycle handling, successful pipe publication, explicit user names surviving PI start, work, settlement, and exit, and cleanup. The `zellij-tabbar` repository's isolated live smoke test verifies exact watcher badges, idle/off/removal behavior, local animation, background completion, and clearing on view without losing watchers with the real WASM plugin. That suite runs against upstream Zellij 0.45.1. It leaves existing sessions and installed plugins untouched.

### Structure

- `pi-extension.ts` registers lifecycle handlers.
- `controller.ts` coalesces lifecycle changes, replays active status for new sidebars, and orders shutdown.
- `tab-binding.ts` owns binding retries and caching for completion visibility checks.
- `ownership.ts` parses pane/tab data and selects the owner. `zellij.ts` only reads Zellij state.
- `activity.ts` owns parent, child, and compaction transitions. `subagent-jobs.ts` adapts named-agent results and reads idle completions.
- `status-model.ts` checks interactive Zellij availability. `commands.ts` keeps stdout-reading commands captured, while `status-transport.ts` serializes status pipes with ignored stdio and a 150 ms deadline.

## License

MIT
