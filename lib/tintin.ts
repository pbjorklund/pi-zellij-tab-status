// Tintin's registry is process-global, but child sessions have their own event buses.
// Adopt it only when it can resolve an id observed on this session's bus.
type Manager = { getRecord(id: string): unknown; hasRunning(): unknown };
const key = Symbol.for("pi-subagents:manager");
function isManager(value: unknown): value is Manager {
  return value !== null && typeof value === "object" &&
    "getRecord" in value && typeof value.getRecord === "function" &&
    "hasRunning" in value && typeof value.hasRunning === "function";
}

export function createTintinObserver(onChange: (working: boolean) => void) {
  let manager: Manager | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let working = false;
  const ownedIds = new Set<string>();
  const pendingReports = new Set<string>();

  function reset() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    manager = undefined;
    working = false;
    ownedIds.clear();
    pendingReports.clear();
  }

  function setWorking(next: boolean) {
    if (next !== working) {
      working = next;
      onChange(working);
    }
    if (working && timer === undefined) timer = setInterval(refresh, 250);
    if (!working && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function refresh() {
    if (!manager) return;
    try {
      // A removed/replaced registry is not evidence that work completed.
      if (Reflect.get(globalThis, key) !== manager) return;
      const running = manager.hasRunning();
      if (typeof running !== "boolean") return;
      for (const id of pendingReports) {
        const record = manager.getRecord(id);
        if (record && typeof record === "object" && !Array.isArray(record) &&
          "id" in record && record.id === id && "resultConsumed" in record && record.resultConsumed === true) {
          pendingReports.delete(id);
        }
      }
      setWorking(running || pendingReports.size > 0);
    } catch {
      // Registry failures cannot manufacture a completion.
    }
  }

  return {
    observe(id: string) {
      try {
        const candidate: unknown = Reflect.get(globalThis, key);
        if (!isManager(candidate) ||
          (manager !== undefined && candidate !== manager)) return;
        const record: unknown = candidate.getRecord(id);
        if (!record || typeof record !== "object" || Array.isArray(record) || !("id" in record) || record.id !== id) return;
        manager = candidate;
        ownedIds.add(id);
        refresh();
      } catch {
        // Independent lifecycle producers need no registry.
      }
    },
    terminal(id: string) {
      if (!ownedIds.has(id)) return;
      // Only a terminal event on this bus creates report ownership. A silent
      // queued stop must not turn an unconsumed record into a pending report.
      pendingReports.add(id);
      refresh();
      if (pendingReports.size > 0) setWorking(true);
    },
    refresh,
    reset,
  };
}
