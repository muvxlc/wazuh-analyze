import { describe, expect, it, vi } from "vitest";
import { findRelatedAlerts } from "./correlate";
import type { Database } from "../db/types";

describe("findRelatedAlerts", () => {
  it("returns empty array if both agentId and ruleId are missing", async () => {
    const mockDb = {} as unknown as Database;
    const res = await findRelatedAlerts(mockDb, {
      alertId: "alert-1",
      agentId: null,
      ruleId: null,
      wazuhTimestamp: new Date("2026-08-06T12:00:00Z"),
    });
    expect(res).toEqual([]);
  });

  it("builds query with correct window, exclusions, and order by", async () => {
    const fakeRows = [
      {
        id: "alert-2",
        ruleId: "5710",
        ruleDescription: "SSHD failed attempt",
        level: 8,
        agentId: "001",
        agentName: "prod-1",
        wazuhTimestamp: new Date("2026-08-06T11:50:00Z"),
        groups: ["syslog", "sshd"],
      },
    ];

    const limitMock = vi.fn().mockResolvedValueOnce(fakeRows);
    const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    const selectMock = vi.fn().mockReturnValue({ from: fromMock });
    const db = { select: selectMock } as unknown as Database;

    const res = await findRelatedAlerts(db, {
      alertId: "alert-1",
      agentId: "001",
      ruleId: "5710",
      wazuhTimestamp: new Date("2026-08-06T12:00:00Z"),
      windowMinutes: 30,
      limit: 5,
    });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(limitMock).toHaveBeenCalledWith(5);
    expect(res).toEqual(fakeRows);
  });
});
