"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// FP Memory settings + signature management. Mirrors settings/soc/page.tsx:
// GET /api/settings for display config, PATCH /api/settings to save the three
// FP toggles; GET /api/fp-signatures for the list; POST/DELETE on
// /api/fp-signatures/[id] for renew/remove. CSRF is enforced server-side via
// assertCsrfSafe (Origin), so no CSRF header is sent — same as every other
// client fetch in this app.
interface FpSettingsData {
  fpMemoryEnabled: boolean;
  fpMemoryTtlDays: number;
  fpMemorySeverityFloor: number;
}

interface FpSignature {
  id: string;
  signatureKey: string;
  ruleId: string | null;
  agentId: string | null;
  level: number | null;
  reason: string | null;
  expiresAt: string;
  lastMatchedAt: string | null;
  matchCount: number;
  enabled: boolean;
}

interface State {
  data: FpSettingsData | null;
  signatures: FpSignature[];
  saving: boolean;
  error: string | null;
  saved: boolean;
}

export default function SettingsFpMemoryPage() {
  const t = useTranslations("settings");
  const [state, setState] = useState<State>({
    data: null,
    signatures: [],
    saving: false,
    error: null,
    saved: false,
  });

  useEffect(() => {
    // Signatures endpoint requires alerts.manage_fp; 403 => show empty list,
    // the settings form still loads for operators who can read config.
    void Promise.all([
      fetch("/api/settings").then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json() as Promise<{ data: Partial<FpSettingsData> }>;
      }),
      fetch("/api/fp-signatures").then((r) =>
        r.ok ? (r.json() as Promise<{ data: FpSignature[] }>) : { data: [] as FpSignature[] },
      ),
    ])
      .then(([settingsBody, sigBody]) => {
        setState((s) => ({
          ...s,
          data: {
            fpMemoryEnabled: settingsBody.data?.fpMemoryEnabled ?? false,
            fpMemoryTtlDays: settingsBody.data?.fpMemoryTtlDays ?? 14,
            fpMemorySeverityFloor: settingsBody.data?.fpMemorySeverityFloor ?? 12,
          },
          signatures: sigBody.data ?? [],
          error: null,
        }));
      })
      .catch(() => setState((s) => ({ ...s, error: t("fetch-error") })));
  }, [t]);

  // ponytail: best-effort refresh after renew/delete; list staleness is non-fatal
  async function refreshSignatures() {
    try {
      const res = await fetch("/api/fp-signatures");
      if (!res.ok) return;
      const body = (await res.json()) as { data: FpSignature[] };
      setState((s) => ({ ...s, signatures: body.data ?? [] }));
    } catch {
      // ignore — user can reload the page
    }
  }

  const handleChange = (field: keyof FpSettingsData, value: string | boolean) => {
    setState((s) => {
      if (!s.data) return s;
      const numeric = typeof value === "string" ? Number(value) : value;
      return { ...s, data: { ...s.data, [field]: numeric }, saved: false };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.data) return;
    setState((s) => ({ ...s, saving: true, error: null, saved: false }));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fpMemoryEnabled: state.data.fpMemoryEnabled,
          fpMemoryTtlDays: state.data.fpMemoryTtlDays,
          fpMemorySeverityFloor: state.data.fpMemorySeverityFloor,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState((s) => ({ ...s, saving: false, saved: true }));
    } catch (err) {
      setState((s) => ({
        ...s,
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  async function handleRenew(id: string) {
    // ttlDays omitted => service renews by effective config fpMemoryTtlDays.
    const res = await fetch(`/api/fp-signatures/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.ok) await refreshSignatures();
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("fp-confirm-delete"))) return;
    const res = await fetch(`/api/fp-signatures/${id}`, { method: "DELETE" });
    if (res.ok) await refreshSignatures();
  }

  if (state.error && !state.data) {
    return (
      <section className="page-section">
        <header>
          <h1>{t("fp-memory-title")}</h1>
        </header>
        <p className="status-error p-4">{state.error}</p>
      </section>
    );
  }

  if (!state.data) {
    return (
      <section className="page-section">
        <header>
          <h1>{t("fp-memory-title")}</h1>
        </header>
        <p className="panel p-4" role="status">
          {t("loading")}
        </p>
      </section>
    );
  }

  return (
    <section className="page-section space-y-6">
      <header>
        <h1>{t("fp-memory-title")}</h1>
      </header>

      <form suppressHydrationWarning onSubmit={handleSubmit} className="panel p-6 space-y-4">
        {state.saved && (
          <p className="text-sm text-green-600" role="status">
            {t("fp-save-success")}
          </p>
        )}
        {state.error && <p className="status-error p-3">{state.error}</p>}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.data.fpMemoryEnabled}
            onChange={(e) => handleChange("fpMemoryEnabled", e.target.checked)}
          />
          {t("fp-memory-enabled")}
        </label>

        <div className="form-field">
          <label htmlFor="fpMemoryTtlDays" className="text-sm text-[var(--color-ink-muted)]">
            {t("fp-memory-ttl-days")}
          </label>
          <input
            id="fpMemoryTtlDays"
            type="number"
            min={1}
            max={90}
            value={state.data.fpMemoryTtlDays}
            onChange={(e) => handleChange("fpMemoryTtlDays", e.target.value)}
            className="auth-input"
          />
        </div>

        <div className="form-field">
          <label htmlFor="fpMemorySeverityFloor" className="text-sm text-[var(--color-ink-muted)]">
            {t("fp-memory-severity-floor")}
          </label>
          <input
            id="fpMemorySeverityFloor"
            type="number"
            min={7}
            max={14}
            value={state.data.fpMemorySeverityFloor}
            onChange={(e) => handleChange("fpMemorySeverityFloor", e.target.value)}
            className="auth-input"
          />
        </div>

        <button
          type="submit"
          disabled={state.saving}
          className="outline-button px-4 py-2 text-sm disabled:opacity-50"
        >
          {state.saving ? t("soc-saving") : t("fp-save")}
        </button>
      </form>

      <div className="panel p-6">
        <h2 className="mb-3 text-sm font-semibold">{t("fp-memory-title")}</h2>
        {state.signatures.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("fp-empty")}</p>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Rule ID</th>
                  <th>Agent</th>
                  <th>Level</th>
                  <th>{t("fp-signature-reason")}</th>
                  <th>{t("fp-signature-expires")}</th>
                  <th>Matches</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {state.signatures.map((sig) => (
                  <tr key={sig.id}>
                    <td>{sig.ruleId ?? "-"}</td>
                    <td>{sig.agentId ?? "-"}</td>
                    <td>{sig.level ?? "-"}</td>
                    <td>{sig.reason ?? "-"}</td>
                    <td>{formatDate(sig.expiresAt)}</td>
                    <td>{sig.matchCount}</td>
                    <td>
                      <span className="flex gap-2">
                        <button
                          type="button"
                          className="outline-button px-2 py-1 text-xs"
                          onClick={() => void handleRenew(sig.id)}
                        >
                          {t("fp-signature-renew")}
                        </button>
                        <button
                          type="button"
                          className="outline-button px-2 py-1 text-xs"
                          onClick={() => void handleDelete(sig.id)}
                        >
                          {t("fp-signature-delete")}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toISOString();
}
