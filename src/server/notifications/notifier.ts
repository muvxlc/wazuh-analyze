import "server-only";

import type { RenderedMessage } from "./render";

export interface NotifierConfig {
  webhookUrl?: string; // Discord
  botToken?: string; // Telegram
  chatId?: string; // Telegram
}

export interface NotificationResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export interface Notifier {
  send(message: RenderedMessage, fetchFn?: typeof fetch): Promise<NotificationResult>;
}

// ponytail: Hard cap at 2000 chars matches Discord webhook payload limit without complex multi-part msg splitting.
function truncate(text: string, max = 2000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

export function truncateToPlatform(text: string, channel: "discord" | "telegram"): string {
  return truncate(text, channel === "telegram" ? 4096 : 2000);
}

export class DiscordNotifier implements Notifier {
  constructor(private readonly webhookUrl: string) {}

  async send(message: RenderedMessage, fetchFn = fetch): Promise<NotificationResult> {
    if (!this.webhookUrl) return { success: false, error: "missing_webhook_url" };

    const content = truncate(`**${message.title}**\n${message.body}`);
    try {
      const res = await fetchFn(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "HTTP error");
        return { success: false, statusCode: res.status, error: truncate(errText, 250) };
      }
      return { success: true, statusCode: res.status };
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return { success: false, error: truncate(err, 250) };
    }
  }
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async send(message: RenderedMessage, fetchFn = fetch): Promise<NotificationResult> {
    if (!this.botToken || !this.chatId) return { success: false, error: "missing_telegram_credentials" };

    const text = truncate(`${message.title}\n\n${message.body}`, 4096);
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "HTTP error");
        return { success: false, statusCode: res.status, error: truncate(errText, 250) };
      }
      return { success: true, statusCode: res.status };
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return { success: false, error: truncate(err, 250) };
    }
  }
}

export function createNotifier(type: "discord" | "telegram", config: NotifierConfig): Notifier {
  if (type === "discord") {
    return new DiscordNotifier(config.webhookUrl ?? "");
  }
  if (type === "telegram") {
    return new TelegramNotifier(config.botToken ?? "", config.chatId ?? "");
  }
  throw new Error(`Unsupported notification channel type: ${type}`);
}
