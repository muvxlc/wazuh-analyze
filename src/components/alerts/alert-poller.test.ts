import { describe, expect, it } from "vitest";
import { nextPollingDelay, queuePolledAlerts, revealQueuedAlerts } from "./alert-poller";
import type { AlertPollingState } from "./alert-poller";

const mockAlert = {
  id: "1",
  wazuhEventId: "evt-1",
  fingerprint: "fp-1",
  wazuhTimestamp: new Date(),
  ingestedAt: new Date(),
  agentId: "001",
  agentName: "agent-1",
  agentIp: "10.0.0.1",
  ruleId: "5710",
  ruleDescription: "ssh login",
  level: 5,
  groups: ["syslog"],
  compliance: {},
  status: "open" as const,
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  resolvedAt: null,
  resolvedByUserId: null,
  rawPayload: {},
};

describe("alert-poller", () => {
  const initialState: AlertPollingState = {
    cursor: null,
    visible: [],
    queued: [],
    connection: "idle",
    consecutiveFailures: 0,
    requiresRefresh: false,
  };

  it("queues incoming alerts without changing visible rows", () => {
    const next = queuePolledAlerts(initialState, [mockAlert]);
    expect(next.queued).toEqual([mockAlert]);
    expect(next.visible).toEqual(initialState.visible);
  });

  it.each([
    [0, 4000],
    [1, 8000],
    [2, 16000],
    [3, 30000],
    [10, 30000],
  ])("backs off %i failures to %ims", (failures, expected) => {
    expect(nextPollingDelay(failures, { normalMs: 4000, maxMs: 30000 })).toBe(expected);
  });

  it("caps queue at 500 and sets requiresRefresh=true when exceeded", () => {
    const manyAlerts = Array.from({ length: 501 }, (_, i) => ({ ...mockAlert, id: String(i) }));
    const next = queuePolledAlerts(initialState, manyAlerts);
    expect(next.requiresRefresh).toBe(true);
    expect(next.queued.length).toBeLessThanOrEqual(500);
  });

  it("reveals queued alerts and merges unique rows by ID", () => {
    const stateWithQueue = {
      ...initialState,
      visible: [mockAlert],
      queued: [{ ...mockAlert, id: "2" }, mockAlert],
    };
    const revealed = revealQueuedAlerts(stateWithQueue);
    expect(revealed.visible.map((a) => a.id)).toEqual(["1", "2"]);
    expect(revealed.queued).toEqual([]);
  });
});
