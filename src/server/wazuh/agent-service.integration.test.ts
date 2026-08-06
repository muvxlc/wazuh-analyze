import { describe, expect, it, vi } from "vitest";
import { getAgentSnapshot } from "./agent-service";
import { WazuhError } from "./errors";
import type { WazuhClient } from "./types";

describe("Agent service integration", () => {
  it("returns stale snapshot when refresh fails", async () => {
    const failingClient: WazuhClient = {
      listAgents: vi.fn().mockRejectedValue(new WazuhError("wazuh_unavailable", 503, "Wazuh unreachable")),
    };
    const now = new Date("2026-08-04T12:00:00Z");
    const fakeDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: "test-id",
                syncedAt: new Date("2026-08-04T11:00:00Z"),
                agents: [{ id: "001", name: "agent-1", status: "active", ip: "10.0.0.1", version: "4.7", lastKeepAlive: null, groups: [] }],
                sourceMetadata: {},
                createdAt: new Date("2026-08-04T11:00:00Z"),
              },
            ]),
          }),
        }),
      }),
    };
    const result = await getAgentSnapshot(fakeDb, failingClient, now);
    expect(result).toMatchObject({
      stale: true,
      upstreamErrorCode: "wazuh_unavailable",
    });
  });
});
