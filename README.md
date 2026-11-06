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
- Publishes `done` once the parent has settled, all tracked subagents have finished, and known pending reports have been consumed. The visible sidebar clears it immediately; the extension confirms tab visibility with bounded backoff and publishes `base` so every sidebar instance converges.
- Publishes watcher state for checklist `C`, project tasks `P`, improvement `I`, GitHub review `R`, and Sentry `S`. The sidebar shows compact pairs after the name in `CPIRS` order: `backoffice Ce|Pw` means checklist error and project working. States are `p` polling, `w` working, `e` error, `h` verified human wait, `q` queued, `a` paused, and `t` other waiting. Off watchers are omitted. Spinners and unseen-completion markers remain independent.
- Publishes a runtime-specific removal during shutdown.
- Never renames tabs. Publishes the PI cwd's folder basename so the sidebar can show folder-only automatic labels, including named PI sessions. Explicit Zellij tab names stay intact. No Git branch inference is used.
- Coalesces event bursts and treats Zellij commands as best effort, so status failures do not block PI lifecycle hooks.

### Subagent providers

Session-scoped `subagents:work` snapshots (`{ sessionId, count }`) remain supported. Their count includes running children and reports awaiting a settled continuation. Only the current session's snapshots affect status; an initial snapshot received before session start is retained for that session. Snapshot updates need no transcript scanning or polling. Watcher letters remain independent. Independent lifecycle producers can also send `subagents:started`, `subagents:completed`, and `subagents:failed` with `{ id }`; repeated starts do not count twice.

Tintin `@tintinweb/pi-subagents` 0.23.1 emits those lifecycle events but no work snapshots. For its queue, the extension also observes `subagents:created` and the optional `Symbol.for("pi-subagents:manager")` registry. It adopts the registry only after `getRecord(id)` resolves an id observed on this session's event bus: merely finding the process-global registry in a child activation is not ownership evidence. The registry's `hasRunning()` boolean keeps status working while execution is running or queued, independently of lifecycle ids and work snapshots. It is never converted into a child count or pending-report evidence.

An observed `subagents:completed` or `subagents:failed` event for an id already resolved through this session's registry also retains that id as a pending report. It keeps status working until the same registry's `getRecord(id)` explicitly returns `resultConsumed === true`. Duplicate terminal events retain one id, not extra work counts. A missing or malformed record, an absent consumption flag, a registry error, or a removed/replaced registry does not prove consumption. The observer never sends a consume RPC.

A local 250 ms check runs while the manager reports running/queued execution or known terminal reports remain pending. It detects both external result consumption and queued cancellations, which Tintin does not announce with terminal events. A stopped queued record without an observed terminal event creates no pending report, even if its consumption flag is false. Parent settlement and child terminal events also refresh the observer. Session replacement and shutdown clear its scoped ids and cancel the check. The check makes no Zellij commands or transcript reads.

Consumption releases only the report: the parent remains working until `agent_settled`, and session-scoped work snapshots remain independent. No aggregate report or consumption state is inferred from `hasRunning()`. Before a matching created/started id is observed, it cannot inspect an unknown registry's queue safely. RPC spawns emit no created event, so a queue-only RPC run is invisible until a started event establishes registry scope. Reload cannot enumerate existing children. Nested/workflow-owned agents and foreground resumes have no matching lifecycle pair: they are not separate tracked ids, though `hasRunning()` includes their execution once registry scope has been established. Without a matching registry, tracking falls back to lifecycle events only.

The extension needs PI 0.87.0 or newer and a Zellij version that provides `list-panes`, `list-tabs`, and `pipe`. Status markers require the matching custom sidebar; Zellij's built-in horizontal tab bar keeps its normal name but does not show PI status.

PI's TUI shows the `pi-zellij-tab-status` info bar only during working or compacting activity, including owned delegated work. Idle, done, and unavailable states stay hidden, including outside Zellij or without a usable pane identity. Sidebar completion markers and status publication are unchanged. The bar uses its own widget key, coexists with watcher and utility bars, and clears on shutdown. The bar adds no Zellij commands, timers, or mutations. RPC, JSON, and print modes do not render it.

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
npm ci
npm test
npm run test:coverage
npm run eval
```

Use Node.js 22.19 or newer; CI uses Node.js 24. The pinned `pi-tui` development dependency supplies terminal components for Node tests. PI supplies its own SDK packages at runtime; optional peer metadata avoids installing another host SDK for standalone development.

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
- `activity.ts` owns parent, delegated-work, child, provider-running, and compaction transitions. `subagent-jobs.ts` consumes session-scoped delegated-work snapshots; `tintin.ts` scopes Tintin's optional manager registry and retains observed terminal reports until confirmed consumed.
- `status-model.ts` checks interactive Zellij availability. `commands.ts` keeps stdout-reading commands captured, while `status-transport.ts` serializes status pipes with ignored stdio and a 150 ms deadline.

## License

MIT
