import { describe, expect, it, vi } from "vitest";
import { runAlertAnalysis, listAlertAnalyses } from "./analyze-service";
import type { ActorContext } from "../authorization/permissions";
import * as query from "../alerts/query";
import * as connections from "./connections";
import * as audit from "../audit/audit-service";

vi.mock("../alerts/query", () => ({
  getAlertDetail: vi.fn(),
}));
vi.mock("./connections", () => ({
  resolveAiConnection: vi.fn(),
  createChatProvider: vi.fn(),
}));
vi.mock("../audit/audit-service", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockActor: ActorContext = { userId: "user-1", role: "admin", permissions: new Set(["alerts.analyze", "alerts.details"]) };
const mockAlert = { id: "alert-1", agentId: "001", agentName: "agent-1", groups: ["web"], ruleId: "5710", ruleDescription: "SSH failed", level: 8, rawPayload: { srcip: "10.0.0.1" } };
const mockConn = { id: "conn-1", provider: "lm_studio" as const, baseUrl: "http://localhost", model: "local-model", apiKey: "test", timeoutMs: 5000 };

describe("analyze-service", () => {
  it("rejects without required permission", async () => {
    const unauthorizedActor: ActorContext = { userId: "u1", role: "user", permissions: new Set() };
    await expect(runAlertAnalysis({} as Parameters<typeof runAlertAnalysis>[0], unauthorizedActor, "a1", {}, { requestId: "r1", ip: null, userAgent: null }, "key")).rejects.toThrow("forbidden");
    await expect(listAlertAnalyses({} as Parameters<typeof listAlertAnalyses>[0], unauthorizedActor, "a1")).rejects.toThrow("forbidden");
  });

  it("happy path runs analysis, inserts row and records audit", async () => {
    vi.mocked(query.getAlertDetail).mockResolvedValue(mockAlert as unknown as Awaited<ReturnType<typeof query.getAlertDetail>>);
    vi.mocked(connections.resolveAiConnection).mockResolvedValue(mockConn);
    const mockProvider = { chat: vi.fn().mockResolvedValue(JSON.stringify({ summary: "SSH Brute Force", confidence: 0.95 })) };

    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "analysis-1" }]),
      }),
    });
    const db = { insert: mockInsert } as unknown as Parameters<typeof runAlertAnalysis>[0];

    const res = await runAlertAnalysis(db, mockActor, "alert-1", {}, { requestId: "r1", ip: "1.1.1.1", userAgent: "ua" }, "key", { provider: mockProvider });
    expect(res).toEqual({ id: "analysis-1", alertId: "alert-1", verdict: { summary: "SSH Brute Force", confidence: 0.95 } });
    expect(audit.writeAuditEvent).toHaveBeenCalledWith(db, expect.objectContaining({ action: "alert.analyze", targetId: "alert-1" }));
  });

  it("passes enrichment context and stores enrichmentsUsed when enrich=true", async () => {
    vi.mocked(query.getAlertDetail).mockResolvedValue({ ...mockAlert, rawPayload: { data: { srcip: "10.0.0.1" } } } as unknown as Awaited<ReturnType<typeof query.getAlertDetail>>);
    vi.mocked(connections.resolveAiConnection).mockResolvedValue(mockConn);
    const mockProvider = { chat: vi.fn().mockResolvedValue(JSON.stringify({ summary: "Enriched", confidence: 0.99 })) };
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "analysis-2" }]),
      }),
    });
    const db = { insert: mockInsert } as unknown as Parameters<typeof runAlertAnalysis>[0];
    const mockContextDeps = {
      ti: {
        providers: [{ name: "test", lookup: async () => ({ indicator: "10.0.0.1", type: "ip" as const, abuseScore: 90, abuseCategory: "malware", pulseCount: 1, sources: ["test"] }) }],
      },
    };

    const res = await runAlertAnalysis(db, mockActor, "alert-1", { enrich: true }, { requestId: "r2", ip: "1.1.1.1", userAgent: "ua" }, "key", { provider: mockProvider, contextDeps: mockContextDeps });
    expect(res.verdict.confidence).toBe(0.99);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockProvider.chat).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("malware"), expect.anything());
  });

  it("listAlertAnalyses returns mapped verdicts", async () => {
    vi.mocked(query.getAlertDetail).mockResolvedValue(mockAlert as unknown as Awaited<ReturnType<typeof query.getAlertDetail>>);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: "ans-1", alertId: "alert-1", provider: "lm_studio", model: "model-x", verdict: { summary: "test", confidence: 0.8 }, createdAt: new Date("2026-08-06T12:00:00Z"), createdByUserId: "user-1" },
            ]),
          }),
        }),
      }),
    } as unknown as Parameters<typeof listAlertAnalyses>[0];

    const items = await listAlertAnalyses(db, mockActor, "alert-1");
    expect(items).toEqual([
      { id: "ans-1", alertId: "alert-1", provider: "lm_studio", model: "model-x", verdict: { summary: "test", confidence: 0.8 }, createdAt: "2026-08-06T12:00:00.000Z", createdByUserId: "user-1" },
    ]);
  });
});
