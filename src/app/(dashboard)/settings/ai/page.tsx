"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bot, Plus, Trash2 } from "lucide-react";

type Provider = "lm_studio" | "openai_compatible";

interface Connection {
  id: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  isDefault: boolean;
  apiKeySet: boolean;
}

interface Draft {
  id: string | null;
  name: string;
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  isDefault: boolean;
  apiKeySet: boolean;
}

const EMPTY: Draft = {
  id: null,
  name: "",
  provider: "lm_studio",
  baseUrl: "http://localhost:1234",
  model: "",
  apiKey: "",
  timeoutMs: 30_000,
  isDefault: false,
  apiKeySet: false,
};

const AGNES_PRESET: Draft = {
  id: null,
  name: "Agnes 2.5 Flash",
  provider: "openai_compatible",
  baseUrl: "https://apihub.agnes-ai.com/v1",
  model: "agnes-2.5-flash",
  apiKey: "",
  timeoutMs: 30_000,
  isDefault: false,
  apiKeySet: false,
};

function providerLabel(provider: Provider): string {
  return provider === "openai_compatible" ? "OpenAI-compatible" : "LM Studio";
}

export default function SettingsAiPage() {
  const t = useTranslations("settings");
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/connections");
      if (!res.ok) throw new Error("fetch failed");
      const body = (await res.json()) as { data: Connection[] };
      setConnections(body.data);
    } catch {
      setError(t("fetch-error"));
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function edit(connection: Connection): void {
    setDraft({
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      baseUrl: connection.baseUrl,
      model: connection.model,
      apiKey: "",
      timeoutMs: connection.timeoutMs,
      isDefault: connection.isDefault,
      apiKeySet: connection.apiKeySet,
    });
    setError(null);
    setNotice(null);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!draft.name.trim() || !draft.model.trim()) {
      setError(t("ai-conn-required"));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name: draft.name.trim(),
        provider: draft.provider,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        apiKey: draft.apiKey ? draft.apiKey : null,
        timeoutMs: draft.timeoutMs,
        isDefault: draft.isDefault,
      };
      const res = await fetch(
        draft.id ? `/api/ai/connections/${draft.id}` : "/api/ai/connections",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Origin: window.location.origin },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft(EMPTY);
      await load();
      setNotice(t("ai-save-success"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function test(): Promise<void> {
    if (!draft.id) {
      setTestResult(t("ai-conn-test-save-first"));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({
          system_prompt: "Connectivity test. Reply with: ok",
          input: "Reply with: ok",
          connection_id: draft.id,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { content?: string } };
      setTestResult(`OK · ${body.data?.content?.slice(0, 80) ?? ""}`);
    } catch (cause) {
      setTestResult(cause instanceof Error ? cause.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!window.confirm(t("ai-conn-confirm-delete"))) return;
    try {
      const res = await fetch(`/api/ai/connections/${id}`, {
        method: "DELETE",
        headers: { Origin: window.location.origin },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  }

  return (
    <section className="page-section space-y-6">
      <header>
        <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">Settings</p>
        <h1>{t("ai")}</h1>
      </header>

      {error && <p className="status-error p-3 text-sm" role="alert">{error}</p>}
      {notice && <p className="text-sm text-green-600" role="status">{notice}</p>}

      <div className="panel divide-y divide-[var(--color-hairline)]">
        {connections === null && (
          <p className="p-4 text-sm text-[var(--color-ink-muted)]" role="status">{t("loading")}</p>
        )}
        {connections?.length === 0 && (
          <p className="p-4 text-sm text-[var(--color-ink-muted)]">{t("ai-conn-empty")}</p>
        )}
        {connections?.map((connection) => (
          <div key={connection.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">
                <Bot size={16} aria-hidden="true" />
                {connection.name}
                {connection.isDefault && (
                  <span className="rounded bg-[var(--color-primary)] px-2 py-0.5 text-xs">default</span>
                )}
              </p>
              <p className="truncate text-xs text-[var(--color-ink-muted)]">
                {providerLabel(connection.provider)} · {connection.model} ·{" "}
                {connection.apiKeySet ? t("ai-api-key-configured") : t("ai-conn-no-key")}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => edit(connection)} className="outline-button px-3 py-1 text-sm">
                {t("ai-conn-edit")}
              </button>
              <button
                type="button"
                onClick={() => void remove(connection.id)}
                aria-label={t("ai-conn-delete")}
                className="outline-button px-2 py-1"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <form suppressHydrationWarning  onSubmit={submit} className="panel space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {draft.id ? t("ai-conn-edit") : t("ai-conn-add")}
          </h2>
          <button
            type="button"
            onClick={() => setDraft(AGNES_PRESET)}
            className="outline-button flex items-center gap-1 px-2 py-1 text-xs"
            title="Agnes 2.5 Flash preset"
          >
            <Plus size={14} aria-hidden="true" /> Agnes
          </button>
        </div>
        <div className="form-field">
          <label htmlFor="ai-name" className="text-sm text-[var(--color-ink-muted)]">{t("ai-conn-name")}</label>
          <input
            id="ai-name"
            className="auth-input"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="My LM Studio / Agnes"
          />
        </div>
        <div className="form-field">
          <label htmlFor="ai-provider" className="text-sm text-[var(--color-ink-muted)]">{t("ai-conn-provider")}</label>
          <select
            id="ai-provider"
            className="auth-input"
            value={draft.provider}
            onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value as Provider }))}
          >
            <option value="lm_studio">LM Studio (local)</option>
            <option value="openai_compatible">OpenAI-compatible (Agnes / cloud)</option>
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="form-field">
            <label htmlFor="ai-base-url" className="text-sm text-[var(--color-ink-muted)]">{t("ai-base-url")}</label>
            <input
              id="ai-base-url"
              type="url"
              className="auth-input"
              value={draft.baseUrl}
              onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
              placeholder={t("ai-base-url-placeholder")}
            />
          </div>
          <div className="form-field">
            <label htmlFor="ai-model" className="text-sm text-[var(--color-ink-muted)]">{t("ai-model")}</label>
            <input
              id="ai-model"
              className="auth-input"
              value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              placeholder={t("ai-model-placeholder")}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="form-field">
            <label htmlFor="ai-timeout" className="text-sm text-[var(--color-ink-muted)]">{t("ai-conn-timeout")}</label>
            <input
              id="ai-timeout"
              type="number"
              min={1000}
              max={300000}
              className="auth-input"
              value={draft.timeoutMs}
              onChange={(e) => setDraft((d) => ({ ...d, timeoutMs: Number(e.target.value) }))}
            />
          </div>
          <div className="form-field">
            <label htmlFor="ai-api-key" className="text-sm text-[var(--color-ink-muted)]">{t("ai-api-key-configured")}</label>
            <input
              id="ai-api-key"
              type="password"
              autoComplete="off"
              className="auth-input"
              placeholder={t("ai-api-key-placeholder")}
              value={draft.apiKey}
              onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
            />
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {draft.apiKeySet ? t("ai-conn-key-set") : t("ai-conn-no-key")}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isDefault}
            onChange={(e) => setDraft((d) => ({ ...d, isDefault: e.target.checked }))}
          />
          {t("ai-conn-default")}
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm disabled:opacity-50">
            {saving ? t("ai-saving") : t("ai-save")}
          </button>
          <button type="button" onClick={() => void test()} disabled={testing || !draft.id} className="outline-button px-4 py-2 text-sm disabled:opacity-50">
            {testing ? t("ai-conn-testing") : t("ai-conn-test")}
          </button>
          <button type="button" onClick={() => setDraft(EMPTY)} className="outline-button px-4 py-2 text-sm">
            {t("ai-conn-clear")}
          </button>
          {testResult && <p className="self-center text-sm text-[var(--color-ink-muted)]" role="status">{testResult}</p>}
        </div>
      </form>
    </section>
  );
}
