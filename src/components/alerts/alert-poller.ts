import type { AlertRecord } from "../../server/alerts/types";

export type AlertListItem = AlertRecord;

export interface AlertPollingState {
  cursor: string | null;
  visible: readonly AlertListItem[];
  queued: readonly AlertListItem[];
  connection: "idle" | "connected" | "backing_off";
  consecutiveFailures: number;
  requiresRefresh: boolean;
}

export function nextPollingDelay(
  failures: number,
  options: { normalMs: number; maxMs: number },
): number {
  if (failures <= 0) return options.normalMs;
  return Math.min(options.maxMs, options.normalMs * 2 ** failures);
}

export function queuePolledAlerts(
  state: AlertPollingState,
  incoming: readonly AlertListItem[],
): AlertPollingState {
  const known = new Set([...state.visible, ...state.queued].map((alert) => alert.id));
  const additions = incoming.filter((alert) => !known.has(alert.id));
  const queued = [...state.queued, ...additions];
  return {
    ...state,
    queued: queued.slice(0, 500),
    requiresRefresh: state.requiresRefresh || queued.length > 500,
  };
}

export function revealQueuedAlerts(state: AlertPollingState): AlertPollingState {
  const byId = new Map<string, AlertListItem>();
  for (const alert of [...state.visible, ...state.queued]) byId.set(alert.id, alert);
  return { ...state, visible: [...byId.values()], queued: [], requiresRefresh: false };
}

export function pollingSucceeded(
  state: AlertPollingState,
  cursor: string | null,
): AlertPollingState {
  return { ...state, cursor, connection: "connected", consecutiveFailures: 0 };
}

export function pollingFailed(state: AlertPollingState): AlertPollingState {
  return {
    ...state,
    connection: "backing_off",
    consecutiveFailures: state.consecutiveFailures + 1,
  };
}
