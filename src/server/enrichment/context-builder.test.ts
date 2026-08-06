import { describe, expect, it, vi } from "vitest";
import {
  buildAnalysisContext,
  extractSrcIp,
  trimToBudget,
  type BuildContextInput,
} from "./context-builder";

describe("context builder", () => {
  const baseInput: BuildContextInput = {
    alertId: "alert-1",
    agentId: "001",
    ruleId: "5710",
    wazuhTimestamp: new Date("2026-08-06T12:00:00Z"),
    groups: ["sshd"],
    level: 8,
    rawPayload: { data: { srcip: "192.168.1.100" } },
  };

  it("extracts srcip from Wazuh raw payload", () => {
    expect(extractSrcIp({ data: { srcip: "8.8.8.8" } })).toBe("8.8.8.8");
    expect(extractSrcIp({ data: { srcip: "" } })).toBeNull();
    expect(extractSrcIp({})).toBeNull();
  });

  it("trims sections to stay within budget bytes", () => {
    const huge = "x".repeat(100);
    const small = "y";
    const sections = { big: huge, tiny: small };

    const trimmed = trimToBudget(sections, 50); // Big exceeds 50 bytes, should be dropped
    expect(trimmed.big).toBeUndefined();
    expect(trimmed.tiny).toBe("y");
  });

  it("gathers context via allSettled without failing when some fetchers blow up", async () => {
    // Inject broken DB that throws on query
    const badDb = {
      select: () => {
        throw new Error("DB Connection lost");
      },
    } as unknown as Parameters<typeof buildAnalysisContext>[1]["db"];

    const mockTiProvider = {
      name: "test-ti",
      lookup: vi.fn().mockResolvedValueOnce({
        indicator: "192.168.1.100",
        type: "ip" as const,
        abuseScore: 90,
        abuseCategory: "brute-force",
        pulseCount: null,
        sources: ["test-ti"],
      }),
    };

    const res = await buildAnalysisContext(
      { ...baseInput, recipe: ["relatedAlerts", "threatIntel"] },
      { db: badDb, ti: { providers: [mockTiProvider] } },
    );

    // DB failed and was swallowed; TI succeeded
    expect(res.enrichmentsUsed).toEqual(["threatIntel"]);
    expect(res.iocLookups).toHaveLength(1);
    expect(res.iocLookups[0].abuseScore).toBe(90);
    expect(res.sections.relatedAlerts).toBeUndefined();
  });

  it("returns empty sections cleanly when no dependencies are provided", async () => {
    const res = await buildAnalysisContext(baseInput, {});
    expect(res).toEqual({ enrichmentsUsed: [], iocLookups: [], sections: {} });
  });
});
