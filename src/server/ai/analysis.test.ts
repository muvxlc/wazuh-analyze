import { describe, expect, it, vi } from "vitest";
import { aiAnalysisSchema, aiVerdictSchema, analyzeAlert, buildAlertAnalysisPrompt } from "./analysis";

const alert = {
  agentId: "001", agentName: "host", groups: ["core"], ruleId: "510",
  ruleDescription: "Rootcheck", level: 12, rawPayload: { full_log: "x" },
};

describe("AI analysis contract", () => {
  it("builds bounded prompt with allowlisted fields", () => {
    const prompt = buildAlertAnalysisPrompt({ ...alert, rawPayload: { secret: "x", full_log: "log" } });
    expect(prompt).toContain("Rootcheck");
    expect(prompt).toContain("core");
    expect(prompt).not.toContain("secret");
  });

  it("validates provider output", async () => {
    const provider = { chat: vi.fn().mockResolvedValue(JSON.stringify({ summary: "s", rootCause: "r", remediation: ["check"], confidence: 0.8, falsePositive: false })) };
    await expect(analyzeAlert(provider, alert)).resolves.toEqual({ summary: "s", rootCause: "r", remediation: ["check"], confidence: 0.8, falsePositive: false });
    expect(aiAnalysisSchema.safeParse({}).success).toBe(false);
  });

  it("accepts verdict after model echoes alert JSON", async () => {
    const provider = {
      chat: vi.fn().mockResolvedValue(
        `${JSON.stringify({ id: "alert", rule: { id: "533" } })}\n${JSON.stringify({ summary: "Port changed", confidence: 0.8 })}`,
      ),
    };
    await expect(analyzeAlert(provider, alert)).resolves.toMatchObject({ summary: "Port changed", confidence: 0.8 });
  });

  it("accepts a rich SOC verdict with optional legacy fields absent", async () => {
    const verdict = {
      summary: "Brute-force against sshd",
      confidence: 0.9,
      likelyFalsePositive: false,
      eventType: "authentication",
      severity: "high",
      affectedAsset: { id: "001", name: "host", type: "linux" },
      observedEvidence: ["5 failed logins from one source"],
      correlation: { relatedAlertCount: 4, note: "same srcip" },
      mitreAttack: [{ techniqueId: "T1110", techniqueName: "Brute Force", tactic: "credential-access" }],
      compliance: ["pci_dss_8.2"],
      recommendedActions: ["block source ip", "review valid users"],
      autoResponseAllowed: false,
      threatIntel: { score: 89, category: "Brute-Force" },
    };
    const provider = { chat: vi.fn().mockResolvedValue(`\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``) };
    await expect(analyzeAlert(provider, alert)).resolves.toMatchObject(verdict);
    expect(aiVerdictSchema.safeParse(verdict).success).toBe(true);
  });

  it("returns typed error for non-JSON provider output", async () => {
    const provider = { chat: vi.fn().mockResolvedValue("not JSON") };
    await expect(analyzeAlert(provider, alert)).rejects.toMatchObject({ code: "ai_response_invalid", status: 502 });
  });

  it("returns typed error for invalid verdict schema", async () => {
    const provider = { chat: vi.fn().mockResolvedValue(JSON.stringify({ confidence: 2 })) };
    await expect(analyzeAlert(provider, alert)).rejects.toMatchObject({ code: "ai_response_invalid", status: 502 });
  });

  it("rejects malformed MITRE technique ids", async () => {
    const provider = {
      chat: vi.fn().mockResolvedValue(JSON.stringify({
        summary: "s",
        confidence: 0.5,
        mitreAttack: [{ techniqueId: "INVALID" }],
      })),
    };
    await expect(analyzeAlert(provider, alert)).rejects.toThrow();
  });

  it("rejects out-of-range confidence", () => {
    expect(
      aiVerdictSchema.safeParse({ summary: "s", confidence: 1.5 }).success,
    ).toBe(false);
  });

  it("appends redacted enrichment context to prompt when provided", () => {
    const ctx = {
      enrichmentsUsed: ["processes"],
      iocLookups: [],
      sections: { processes: [{ name: "bash", apiKey: "secret_value" }] },
    };
    const prompt = buildAlertAnalysisPrompt(alert, ctx);
    expect(prompt).toContain("enrichment");
    expect(prompt).toContain("bash");
    expect(prompt).not.toContain("secret_value");
  });

  it("strips verbose alert fields and bounds surviving oversized payloads", () => {
    const prompt = buildAlertAnalysisPrompt({
      ...alert,
      rawPayload: {
        rule: { id: "510", description: "Rootcheck" },
        full_log: "sensitive verbose log ".repeat(2_000),
        previous_output: "old output",
        previous_log: "netstat log dump",
        netstat: "network output",
        useful: "kept ".repeat(4_000),
      },
    });
    expect(prompt.length).toBeLessThan(10_000);
    expect(prompt).toContain("[truncated]");
    expect(prompt).not.toContain("sensitive verbose log");
    expect(prompt).not.toContain("old output");
    expect(prompt).not.toContain("netstat log dump");
    expect(prompt).not.toContain("network output");
  });
});
