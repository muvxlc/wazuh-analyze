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
});
