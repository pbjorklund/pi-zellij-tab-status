import assert from "node:assert/strict";

export function required<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null, "expected fixture value");
  return value;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), "expected record");
  return value;
}
export type StatusMessage = Record<string, unknown> & {
  v: number; kind: string; runtime_id: string; seq: number; pane_id: number;
  mode?: string; folder?: string;
  watcher_states?: Record<string, { status: string; waiting_kind?: string }>;
};
function isStatusMessage(value: unknown): value is StatusMessage {
  if (!isRecord(value) || typeof value.v !== "number" || typeof value.kind !== "string" ||
    typeof value.runtime_id !== "string" || typeof value.seq !== "number" || typeof value.pane_id !== "number" ||
    (value.mode !== undefined && typeof value.mode !== "string") ||
    (value.folder !== undefined && typeof value.folder !== "string")) return false;
  return value.watcher_states === undefined || (isRecord(value.watcher_states) &&
    Object.values(value.watcher_states).every(detail => isRecord(detail) && typeof detail.status === "string" &&
      (detail.waiting_kind === undefined || typeof detail.waiting_kind === "string")));
}
export function statusMessage(text: string): StatusMessage {
  const value: unknown = JSON.parse(text);
  assert.ok(isStatusMessage(value), "expected status protocol message");
  return value;
}
