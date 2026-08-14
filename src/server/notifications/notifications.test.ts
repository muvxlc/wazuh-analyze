import { describe, expect, it, vi } from "vitest";

import { createNotifier, DiscordNotifier, TelegramNotifier, truncateToPlatform } from "./notifier";
import { renderNotification } from "./render";

describe("renderNotification", () => {
  it("renders high severity alert correctly with deep link", () => {
    const rendered = renderNotification(
      {
        type: "alert.high_severity",
        targetId: "abc-123",
        severity: 12,
        title: "SSH Brute Force Detected",
        summary: "10 failed attempts",
      },
      "https://soc.wazuh.internal",
    );
    expect(rendered.title).toBe("🚨 [Wazuh Alert] SSH Brute Force Detected");
    expect(rendered.url).toBe("https://soc.wazuh.internal/alerts/abc-123");
    expect(rendered.body).toContain("Severity: 12");
    expect(rendered.body).toContain("https://soc.wazuh.internal/alerts/abc-123");
  });

  it("renders incident created with correct deep link and fallback summary", () => {
    const rendered = renderNotification({
      type: "incident.created",
      targetId: "inc-456",
      title: "Suspicious Privilege Escalation",
    });
    expect(rendered.title).toBe("⚠️ [New Incident] Suspicious Privilege Escalation");
    expect(rendered.url).toContain("/incidents/inc-456");
    expect(rendered.body).toContain("No summary provided.");
    expect(rendered.severity).toBe("N/A");
  });

  it("renders vulnerability.analysis_completed with seven labeled sections", () => {
    const event = {
      type: "vulnerability.analysis_completed" as const,
      targetId: "vuln-999",
      agentId: "agent-100",
      sourceId: "cve-2024-1234",
      cve: "CVE-2024-1234",
      severity: "critical" as const,
      title: "Remote Code Execution in curl",
      summary: "High-risk flaw in HTTP parser",
      sections: {
        summaryImpact: { en: "RCE possible", th: "อาจเกิด RCE ได้" },
        cveDetails: { en: "CVE-2024-1234 affects curl < 8.0", th: "CVE-2024-1234 มีผลต่อ curl < 8.0" },
        attackConditions: { en: "Requires authenticated HTTP request", th: "ต้องการคำขอ HTTP ที่ยืนยันตัวตน" },
        riskAssessment: { en: "CVSS 9.8, unauthenticated exploitation possible", th: "CVSS 9.8, อาจถูกโจมตีได้โดยไม่จำเป็นต้องยืนยันตัวตน" },
        remediation: { en: ["Upgrade to curl 8.0", "Apply WAF rules"], th: ["อัปเกรดเป็น curl 8.0", "ติดตั้งกฎ WAF"] },
        postFixVerification: { en: ["Verify curl version is 8.0+"], th: ["ตรวจสอบว่า curl เป็นเวอร์ชัน 8.0+"] },
        unknowns: { en: ["Exploit PoC not publicly available"], th: ["ยังไม่มียังไม่มี PoC การโจมตีสายสาธารณะ"] },
      },
    };
    const rendered = renderNotification(event, "https://soc.wazuh.internal");

    expect(rendered.title).toBe("⚠️ [Vulnerability Analysis] Remote Code Execution in curl");
    expect(rendered.url).toBe("https://soc.wazuh.internal/vulnerabilities/agent-100/cve-2024-1234");
    expect(rendered.severity).toBe("critical");
    expect(rendered.body).toContain("CVE: CVE-2024-1234");
    expect(rendered.body).toContain("Agent: agent-100");
    expect(rendered.body).toContain("Source: cve-2024-1234");
    expect(rendered.body).toContain("Summary & Impact / สรุปและผลกระทบ");
    expect(rendered.body).toContain("CVE Details / รายละเอียด CVE");
    expect(rendered.body).toContain("Attack Conditions / เงื่อนไขการโจมตี");
    expect(rendered.body).toContain("Risk Assessment / การประเมินความเสี่ยง");
    expect(rendered.body).toContain("Remediation / การแก้ไข");
    expect(rendered.body).toContain("Post-Fix Verification / การตรวจสอบหลังแก้ไข");
    expect(rendered.body).toContain("Unknown Information / ข้อมูลที่ยังไม่ทราบ");
    expect(rendered.body).toContain("RCE possible | อาจเกิด RCE ได้");
    expect(rendered.body).toContain("Upgrade to curl 8.0 | อัปเกรดเป็น curl 8.0");
    expect(rendered.body).toContain("/vulnerabilities/");
  });

  it("renders vulnerability with minimal fields (fallback values)", () => {
    const rendered = renderNotification({
      type: "vulnerability.analysis_completed",
      targetId: "vuln-1",
      title: "Minimal vuln",
    }, "https://soc.wazuh.internal");
    expect(rendered.url).toBe("https://soc.wazuh.internal/vulnerabilities/vuln-1/vuln-1");
    expect(rendered.body).toContain("Severity: N/A");
    expect(rendered.severity).toBe("N/A");
    expect(rendered.body).not.toContain("CVE:");
    expect(rendered.body).not.toContain("Agent:");
  });

  it("rendering uses sourceId in deep link when provided", () => {
    const rendered = renderNotification({
      type: "vulnerability.analysis_completed",
      targetId: "fallback-id",
      agentId: "agent-2",
      sourceId: "src-3",
      title: "Titled",
    }, "https://localhost:3000");
    expect(rendered.url).toBe("https://localhost:3000/vulnerabilities/agent-2/src-3");
  });

  it("renders vulnerability with unknown sections omitted when absent", () => {
    const rendered = renderNotification({
      type: "vulnerability.analysis_completed",
      targetId: "v1",
      title: "Only summary",
      sections: {
        summaryImpact: { en: "Some impact", th: "ผลกระทบบางอย่าง" },
      },
    }, "https://soc.wazuh.internal");
    expect(rendered.body).toContain("Summary & Impact");
    expect(rendered.body).not.toContain("CVE Details");
    expect(rendered.body).not.toContain("Attack Conditions");
  });

  it("keeps existing alert/incident output unchanged", () => {
    const alert = renderNotification({
      type: "alert.high_severity",
      targetId: "a-1",
      severity: "high",
      title: "Alert title",
      summary: "Alert body",
    });
    expect(alert.title).toMatch(/\[Wazuh Alert\]/);
    expect(alert.url).toContain("/alerts/a-1");

    const incident = renderNotification({
      type: "incident.created",
      targetId: "i-1",
      title: "Incident title",
    });
    expect(incident.title).toMatch(/\[New Incident\]/);
    expect(incident.url).toContain("/incidents/i-1");
  });
});

describe("notifiers", () => {
  it("factory creates correct notifier instance", () => {
    const discord = createNotifier("discord", { webhookUrl: "https://discord.local" });
    expect(discord).toBeInstanceOf(DiscordNotifier);
    const telegram = createNotifier("telegram", { botToken: "tok", chatId: "chat" });
    expect(telegram).toBeInstanceOf(TelegramNotifier);
  });

  it("DiscordNotifier sends POST request and enforces 2000 character truncation", async () => {
    const notifier = new DiscordNotifier("https://discord.com/api/webhooks/123/abc");
    const longBody = "A".repeat(2500);

    let sentBody = "";
    const mockFetch = vi.fn().mockImplementationOnce((url: string, opts: any) => {
      sentBody = opts.body;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    const res = await notifier.send(
      { title: "Long Title", body: longBody, severity: "12", url: "http://url" },
      mockFetch as unknown as typeof fetch,
    );

    expect(res.success).toBe(true);
    expect(res.statusCode).toBe(204);
    const parsed = JSON.parse(sentBody);
    expect(parsed.content.length).toBeLessThanOrEqual(2000);
    expect(parsed.content.endsWith("...")).toBe(true);
  });

  it("TelegramNotifier handles API errors gracefully", async () => {
    const notifier = new TelegramNotifier("token123", "chat999");
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const res = await notifier.send(
      { title: "Test Alert", body: "Body text", severity: "high", url: "http://url" },
      mockFetch as unknown as typeof fetch,
    );

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.error).toBe("Unauthorized");
  });

  it("returns error without throwing when credentials missing", async () => {
    const emptyDiscord = new DiscordNotifier("");
    expect(await emptyDiscord.send({ title: "T", body: "B", severity: "1", url: "U" })).toEqual({
      success: false,
      error: "missing_webhook_url",
    });

    const emptyTg = new TelegramNotifier("", "");
    expect(await emptyTg.send({ title: "T", body: "B", severity: "1", url: "U" })).toEqual({
      success: false,
      error: "missing_telegram_credentials",
    });
  });

  it("TelegramNotifier enforces 4096 character truncation", async () => {
    const notifier = new TelegramNotifier("bot-token", "chat-id");
    const longBody = "B".repeat(4500);

    let sentBody = "";
    const mockFetch = vi.fn().mockImplementationOnce((url: string, opts: any) => {
      sentBody = opts.body;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    const res = await notifier.send(
      { title: "Telegram long", body: longBody, severity: "5", url: "http://url" },
      mockFetch as unknown as typeof fetch,
    );

    expect(res.success).toBe(true);
    const parsed = JSON.parse(sentBody);
    expect(parsed.text.length).toBeLessThanOrEqual(4096);
    expect(parsed.text.endsWith("...")).toBe(true);
  });

  it("channel errors return {success:false, error}", async () => {
    const discord = new DiscordNotifier("https://discord.com/api/webhooks/1/2");
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error("Network failure"));
    const res = await discord.send(
      { title: "T", body: "B", severity: "1", url: "U" },
      mockFetch as unknown as typeof fetch,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();

    const telegram = new TelegramNotifier("tok", "chat");
    const mockFetch2 = vi.fn().mockRejectedValueOnce(new TypeError("ENOTFOUND"));
    const res2 = await telegram.send(
      { title: "T", body: "B", severity: "1", url: "U" },
      mockFetch2 as unknown as typeof fetch,
    );
    expect(res2.success).toBe(false);
    expect(res2.error).toBeTruthy();
  });
});

describe("truncateToPlatform", () => {
  it("returns text unchanged when under Discord cap", () => {
    expect(truncateToPlatform("short", "discord")).toBe("short");
  });

  it("returns text unchanged when under Telegram cap", () => {
    expect(truncateToPlatform("A".repeat(1000), "telegram")).toBe("A".repeat(1000));
  });

  it("truncates to Discord cap with ellipsis", () => {
    const result = truncateToPlatform("X".repeat(2500), "discord");
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result.endsWith("...")).toBe(true);
  });

  it("truncates to Telegram cap with ellipsis", () => {
    const result = truncateToPlatform("Y".repeat(5000), "telegram");
    expect(result.length).toBeLessThanOrEqual(4096);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("targetType mapping in dispatcher", () => {
  it("vulnerability events do not throw and accept partial sections", async () => {
    const { dispatchNotification } = await import("./dispatcher");
    const deliveries: Array<{ eventType: string; targetType: string }> = [];
    // Stub with innerJoin chain matching real drizzle-call pattern
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((v: typeof deliveries[number]) => {
          deliveries.push(v);
          return Promise.resolve([]);
        }),
      }),
    };
    await dispatchNotification(
      db as any,
      {
        type: "vulnerability.analysis_completed",
        targetId: "v1",
        title: "Vuln test",
        agentId: "a1",
        sourceId: "s1",
        sections: { summaryImpact: { en: "impact", th: "impact-th" } },
      },
      "enc-key",
    );
    // No rules matched, so no deliveries — validates event shape is accepted
    expect(deliveries.length).toBe(0);
  });
});
