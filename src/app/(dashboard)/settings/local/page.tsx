"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface SettingsData {
  retentionDays: number;
  maintenanceBatchSize: number;
  nodeEnv: string;
  appUrl: string;
}

interface State {
  data: SettingsData | null;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

export default function SettingsLocalPage() {
  const t = useTranslations("settings");
  const [state, setState] = useState<State>({
    data: null,
    saving: false,
    error: null,
    saved: false,
  });

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((b: { data: SettingsData }) => setState((s) => ({ ...s, data: b.data, error: null })))
      .catch(() => setState((s) => ({ ...s, error: t("fetch-error") })));
  }, [t]);

  const handleChange = (field: keyof SettingsData, value: string) => {
    setState((s) => {
      const numeric = field !== "nodeEnv" && field !== "appUrl" ? Number(value) : value;
      return { ...s, data: s.data ? { ...s.data, [field]: numeric } : null };
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
          alertRetentionDays: state.data.retentionDays,
          maintenanceBatchSize: state.data.maintenanceBatchSize,
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

  if (state.error && !state.data) {
    return (
      <section className="page-section">
        <header>
          <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">Settings</p>
          <h1>{t("local")}</h1>
        </header>
        <p className="status-error p-4">{state.error}</p>
      </section>
    );
  }

  if (!state.data) {
    return (
      <section className="page-section">
        <header>
          <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">Settings</p>
          <h1>{t("local")}</h1>
        </header>
        <p className="panel p-4" role="status">{t("loading")}</p>
      </section>
    );
  }

  return (
    <section className="page-section space-y-6">
      <header>
        <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">Settings</p>
        <h1>{t("local")}</h1>
      </header>
      <form suppressHydrationWarning onSubmit={handleSubmit} className="panel p-6 space-y-4">
        {state.saved && (
          <p className="text-sm text-green-600" role="status">{t("local-save-success")}</p>
        )}
        {state.error && <p className="status-error p-3">{state.error}</p>}
        <div className="form-field">
          <label htmlFor="retentionDays" className="text-sm text-[var(--color-ink-muted)]">
            {t("local-retention-days")}
          </label>
          <input
            id="retentionDays"
            type="number"
            min={1}
            max={3650}
            value={state.data.retentionDays}
            onChange={(e) => handleChange("retentionDays", e.target.value)}
            className="auth-input"
            aria-describedby="retention-hint"
          />
          <p id="retention-hint" className="text-xs text-[var(--color-ink-muted)] mt-1">
            1–3650 days
          </p>
        </div>
        <div className="form-field">
          <label htmlFor="maintenanceBatchSize" className="text-sm text-[var(--color-ink-muted)]">
            {t("local-maintenance-batch-size")}
          </label>
          <input
            id="maintenanceBatchSize"
            type="number"
            min={1}
            max={1_000_000}
            value={state.data.maintenanceBatchSize}
            onChange={(e) => handleChange("maintenanceBatchSize", e.target.value)}
            className="auth-input"
          />
        </div>
        <div className="flex items-center justify-between border-t border-[var(--color-hairline)] pt-3">
          <div>
            <span className="text-sm text-[var(--color-ink-muted)]">{t("local-node-env")}</span>
            <span className="ml-2 text-sm font-medium capitalize">{state.data.nodeEnv}</span>
          </div>
          <div>
            <span className="text-sm text-[var(--color-ink-muted)]">{t("local-app-url")}</span>
            <span className="ml-2 text-sm font-medium break-all">{state.data.appUrl}</span>
          </div>
        </div>
        <button
          type="submit"
          disabled={state.saving}
          className="outline-button px-4 py-2 text-sm disabled:opacity-50"
        >
          {state.saving ? t("local-saving") : t("local-save")}
        </button>
      </form>
    </section>
  );
}
