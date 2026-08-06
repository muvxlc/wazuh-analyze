import { describe, expect, it, vi } from "vitest";
import { getDashboardSummary } from "./dashboard-service";

describe("Dashboard service integration", () => {
  it("fetches dashboard summary with health, agents, alerts, and workflows", async () => {
    const fakeDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue([]),
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    const summary = await getDashboardSummary(fakeDb as any, { userId: "u1", role: "admin", permissions: new Set(["dashboard.read"]) });
    expect(summary).toHaveProperty("agentStatus");
    expect(summary).toHaveProperty("alertSeverity");
    expect(summary).toHaveProperty("workflows");
  });
});
