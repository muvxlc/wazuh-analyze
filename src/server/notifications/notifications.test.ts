import { describe, expect, it, vi } from "vitest";

import { createNotifier, DiscordNotifier, TelegramNotifier } from "./notifier";
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
    const mockFetch = vi.fn().mockImplementationOnce((url, opts) => {
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
});
