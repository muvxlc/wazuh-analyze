"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, Trash2, CheckCircle2 } from "lucide-react";

interface Channel {
  id: string;
  name: string;
  type: "discord" | "telegram";
  enabled: boolean;
}

interface Rule {
  id: string;
  eventType: string;
  severityThreshold: number | null;
  channelId: string;
  enabled: boolean;
}

export default function SettingsNotificationsPage() {
  const t = useTranslations("settings");
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [rules, setRules] = useState<Rule[] | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [type, setType] = useState<"discord" | "telegram">("discord");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");

  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [eventType, setEventType] = useState<string>("alert.high_severity");
  const [threshold, setThreshold] = useState<string>("12");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [resChan, resRules] = await Promise.all([
        fetch("/api/notifications/channels"),
        fetch("/api/notifications/rules"),
      ]);
      if (resChan.ok && resRules.ok) {
        const cBody = (await resChan.json()) as { data: Channel[] };
        const rBody = (await resRules.json()) as { data: Rule[] };
        setChannels(cBody.data);
        setRules(rBody.data);
        if (cBody.data.length && !selectedChannel) {
          setSelectedChannel(cBody.data[0]!.id);
        }
      }
    } catch {
      setError("Failed to load notification configurations.");
    }
  }, [selectedChannel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function addChannel(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Channel name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload =
        type === "discord"
          ? { name: name.trim(), type, webhookUrl: webhookUrl.trim() }
          : { name: name.trim(), type, botToken: botToken.trim(), chatId: chatId.trim() };

      const res = await fetch("/api/notifications/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setName("");
      setWebhookUrl("");
      setBotToken("");
      setChatId("");
      await load();
      setNotice("Channel added successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add channel.");
    } finally {
      setSaving(false);
    }
  }

  async function addRule(e: FormEvent) {
    e.preventDefault();
    if (!selectedChannel) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({
          channelId: selectedChannel,
          eventType,
          severityThreshold: threshold ? Number(threshold) : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      setNotice("Rule added successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add rule.");
    } finally {
      setSaving(false);
    }
  }

  async function removeChannel(id: string) {
    if (!window.confirm("Delete channel and all its rules?")) return;
    try {
      await fetch(`/api/notifications/channels/${id}`, { method: "DELETE", headers: { Origin: window.location.origin } });
      await load();
    } catch {
      setError("Failed to delete channel.");
    }
  }

  async function removeRule(id: string) {
    try {
      await fetch(`/api/notifications/rules/${id}`, { method: "DELETE", headers: { Origin: window.location.origin } });
      await load();
    } catch {
      setError("Failed to delete rule.");
    }
  }

  async function testChannel(id: string) {
    setTestingId(id);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({ channelId: id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `Test failed with HTTP ${res.status}`);
      }
      setNotice("Test notification transmitted successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test notification failed.");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <section className="page-section space-y-6">
      <header>
        <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">Settings</p>
        <h1>{t("notifications", { fallback: "Notifications" })}</h1>
      </header>

      {error && <p className="status-error p-3 text-sm" role="alert">{error}</p>}
      {notice && <p className="p-3 text-sm text-green-600 font-medium" role="status">{notice}</p>}

      <div className="panel space-y-4 p-6">
        <h2 className="text-sm font-semibold">Notification Channels</h2>
        <div className="divide-y divide-[var(--color-hairline)]">
          {channels?.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium flex items-center gap-2">
                  <Bell size={16} aria-hidden="true" />
                  {c.name} <span className="rounded bg-[var(--color-canvas-soft)] px-2 py-0.5 text-xs uppercase">{c.type}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={testingId === c.id}
                  onClick={() => void testChannel(c.id)}
                  className="outline-button flex items-center gap-1 px-3 py-1 text-xs"
                >
                  <CheckCircle2 size={14} aria-hidden="true" /> {testingId === c.id ? "Testing…" : "Test"}
                </button>
                <button
                  type="button"
                  onClick={() => void removeChannel(c.id)}
                  className="outline-button px-2 py-1"
                  aria-label="Delete channel"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          {channels?.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] py-2">No notification channels set up yet.</p>}
        </div>

        <form onSubmit={(e) => void addChannel(e)} className="space-y-3 pt-4 border-t border-[var(--color-hairline)]">
          <p className="text-xs font-medium text-[var(--color-ink-muted)]">Add Channel</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="auth-input text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Channel Name"
            />
            <select
              className="auth-input text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as "discord" | "telegram")}
            >
              <option value="discord">Discord</option>
              <option value="telegram">Telegram</option>
            </select>
          </div>
          {type === "discord" ? (
            <input
              className="auth-input text-sm w-full"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="auth-input text-sm"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="Bot Token (e.g., 123456:ABC-DEF...)"
              />
              <input
                className="auth-input text-sm"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="Chat ID (e.g., -10012345678)"
              />
            </div>
          )}
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm disabled:opacity-50">
            Add Channel
          </button>
        </form>
      </div>

      <div className="panel space-y-4 p-6">
        <h2 className="text-sm font-semibold">Dispatch Rules</h2>
        <div className="divide-y divide-[var(--color-hairline)]">
          {rules?.map((r) => {
            const chan = channels?.find((c) => c.id === r.channelId);
            return (
              <div key={r.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <span className="font-semibold text-[var(--color-primary-deep)]">{r.eventType}</span> →{" "}
                  <span className="font-medium">{chan?.name ?? r.channelId}</span>
                  {r.severityThreshold !== null && (
                    <span className="ml-2 text-xs text-[var(--color-ink-muted)]">(Min severity: {r.severityThreshold})</span>
                  )}
                </div>
                <button type="button" onClick={() => void removeRule(r.id)} className="outline-button px-2 py-1" aria-label="Remove rule">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {rules?.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] py-2">No active dispatch rules configured.</p>}
        </div>

        {channels && channels.length > 0 && (
          <form onSubmit={(e) => void addRule(e)} className="space-y-3 pt-4 border-t border-[var(--color-hairline)]">
            <p className="text-xs font-medium text-[var(--color-ink-muted)]">Bind Event Rule</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <select className="auth-input text-sm" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="alert.high_severity">High Severity Alert</option>
                <option value="incident.created">Incident Created</option>
                <option value="incident.escalated">Incident Escalated</option>
                <option value="verdict.confident_real">AI Confirmed Threat</option>
              </select>
              <select className="auth-input text-sm" value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                max="100"
                className="auth-input text-sm"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="Min Severity (Optional)"
              />
            </div>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm disabled:opacity-50">
              Add Rule
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
