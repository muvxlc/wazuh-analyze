"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface SocSettingsData {
  socAutoAnalyze: boolean;
  socAutoAnalyzeVulnerabilities: boolean;
  socAutoAnalyzeMinLevel: number;
  socAutoCreateIncident: boolean;
  socAutoIncidentMinConfidence: number;
  socAutoIncidentRequireCorroboration: boolean;
  tiProviders: string;
  abuseipdbKeySet: boolean;
  otxKeySet: boolean;
  greynoiseKeySet: boolean;
  tiMinLevel: number;
  tiCacheTtlDays: number;
  analyzeCooldownSeconds: Record<string, number>;
  analysisTagScope: { allowTags: string[]; denyTags: string[] } | null;
}

interface State {
  data: SocSettingsData | null;
  saving: boolean;
  error: string | null;
  saved: boolean;
  /** Write-only key inputs: empty until the operator types a new secret. */
  abuseipdbKey: string;
  otxKey: string;
  greynoiseKey: string;
  /** Cooldown editor: "ruleId:minutes" lines + a default (global) minutes. */
  cooldownLines: string;
  cooldownDefault: string;
  allowTagsLines: string;
  denyTagsLines: string;
}

export default function SettingsSocPage() {
  const t = useTranslations("settings");
  const [state, setState] = useState<State>({
    data: null,
    saving: false,
    error: null,
    saved: false,
    abuseipdbKey: "",
    otxKey: "",
    greynoiseKey: "",
    cooldownLines: "",
    cooldownDefault: "60",
    allowTagsLines: "",
    denyTagsLines: "",
  });

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((b: { data: SocSettingsData }) =>
        setState((s) => ({
          ...s,
          data: b.data,
          error: null,
          cooldownLines: Object.entries(b.data.analyzeCooldownSeconds)
            .map(([rule, sec]) => `${rule}:${Math.round(sec / 60)}`)
            .join("\n"),
          allowTagsLines: (b.data.analysisTagScope?.allowTags ?? []).join("\n"),
          denyTagsLines: (b.data.analysisTagScope?.denyTags ?? []).join("\n"),
        })),
      )
      .catch(() => setState((s) => ({ ...s, error: t("fetch-error") })));
  }, [t]);

  const handleChange = (field: keyof SocSettingsData, value: string | boolean) => {
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
      const payload: Record<string, unknown> = {
        socAutoAnalyze: state.data.socAutoAnalyze,
        socAutoAnalyzeVulnerabilities: state.data.socAutoAnalyzeVulnerabilities,
        socAutoAnalyzeMinLevel: state.data.socAutoAnalyzeMinLevel,
        socAutoCreateIncident: state.data.socAutoCreateIncident,
        socAutoIncidentMinConfidence: state.data.socAutoIncidentMinConfidence,
        socAutoIncidentRequireCorroboration: state.data.socAutoIncidentRequireCorroboration,
        tiProviders: state.data.tiProviders.trim(),
        tiMinLevel: state.data.tiMinLevel,
        tiCacheTtlDays: state.data.tiCacheTtlDays,
      };
      // Only send secret keys when the operator typed a new value.
      if (state.abuseipdbKey.trim()) payload.abuseipdbKey = state.abuseipdbKey.trim();
      if (state.otxKey.trim()) payload.otxKey = state.otxKey.trim();
      if (state.greynoiseKey.trim()) payload.greynoiseKey = state.greynoiseKey.trim();

      // Cooldown: "ruleId:minutes" per line → {ruleId: seconds}.
      const cooldown: Record<string, number> = {};
      for (const raw of state.cooldownLines.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        const [rule, mins] = line.split(":");
        if (!rule || !mins) continue;
        const n = Number(mins.trim());
        if (Number.isFinite(n) && n >= 0) cooldown[rule.trim()] = Math.round(n * 60);
      }
      const def = Number(state.cooldownDefault);
      payload.analyzeCooldownSeconds = { ...cooldown, "*": Number.isFinite(def) && def >= 0 ? Math.round(def * 60) : 3600 };

      // Tag scope: one tag per line, trimmed, empties dropped (order preserved).
      const parseTags = (lines: string) =>
        lines
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
      const allowTags = parseTags(state.allowTagsLines);
      const denyTags = parseTags(state.denyTagsLines);
      payload.analysisTagScope = { allowTags, denyTags };

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState((s) => ({
        ...s,
        saving: false,
        saved: true,
        abuseipdbKey: "",
        otxKey: "",
        greynoiseKey: "",
        data: s.data
          ? {
              ...s.data,
              abuseipdbKeySet: s.abuseipdbKey.trim().length > 0 ? true : s.data.abuseipdbKeySet,
              otxKeySet: s.otxKey.trim().length > 0 ? true : s.data.otxKeySet,
              greynoiseKeySet: s.greynoiseKey.trim().length > 0 ? true : s.data.greynoiseKeySet,
              analyzeCooldownSeconds: cooldown,
              analysisTagScope: { allowTags, denyTags },
            }
          : null,
      }));
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
          <h1>{t("soc")}</h1>
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
          <h1>{t("soc")}</h1>
        </header>
        <p className="panel p-4" role="status">{t("loading")}</p>
      </section>
    );
  }

  return (
    <section className="page-section space-y-6">
      <header>
        <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">Settings</p>
        <h1>{t("soc")}</h1>
      </header>
      <form suppressHydrationWarning onSubmit={handleSubmit} className="panel p-6 space-y-4">
        {state.saved && (
          <p className="text-sm text-green-600" role="status">{t("soc-save-success")}</p>
        )}
        {state.error && <p className="status-error p-3">{state.error}</p>}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.data.socAutoAnalyze}
            onChange={(e) => handleChange("socAutoAnalyze", e.target.checked)}
          />
          {t("soc-auto-analyze")}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.data.socAutoAnalyzeVulnerabilities}
            onChange={(e) => handleChange("socAutoAnalyzeVulnerabilities", e.target.checked)}
          />
          {t("soc-auto-analyze-vulnerabilities")}
        </label>

        <div className="form-field">
          <label htmlFor="socAutoAnalyzeMinLevel" className="text-sm text-[var(--color-ink-muted)]">
            {t("soc-auto-analyze-min-level")}
          </label>
          <input
            id="socAutoAnalyzeMinLevel"
            type="number"
            min={1}
            max={15}
            value={state.data.socAutoAnalyzeMinLevel}
            onChange={(e) => handleChange("socAutoAnalyzeMinLevel", e.target.value)}
            className="auth-input"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.data.socAutoCreateIncident}
            onChange={(e) => handleChange("socAutoCreateIncident", e.target.checked)}
          />
          {t("soc-auto-create-incident")}
        </label>

        <div className="form-field">
          <label htmlFor="socAutoIncidentMinConfidence" className="text-sm text-[var(--color-ink-muted)]">
            {t("soc-auto-incident-min-confidence")}
          </label>
          <input
            id="socAutoIncidentMinConfidence"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={state.data.socAutoIncidentMinConfidence}
            onChange={(e) => handleChange("socAutoIncidentMinConfidence", e.target.value)}
            className="auth-input"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.data.socAutoIncidentRequireCorroboration}
            onChange={(e) => handleChange("socAutoIncidentRequireCorroboration", e.target.checked)}
          />
          {t("soc-auto-incident-require-corboration")}
        </label>

        <div className="border-t border-[var(--color-hairline)] pt-4 space-y-4">
          <h2 className="text-sm font-semibold">Threat Intelligence</h2>

          <div className="form-field">
            <label htmlFor="tiProviders" className="text-sm text-[var(--color-ink-muted)]">
              {t("ti-providers")}
            </label>
            <input
              id="tiProviders"
              type="text"
              value={state.data.tiProviders}
              onChange={(e) => handleChange("tiProviders", e.target.value)}
              className="auth-input"
              placeholder="abuseipdb,otx,greynoise"
            />
          </div>

          <div className="form-field">
            <label htmlFor="abuseipdbKey" className="text-sm text-[var(--color-ink-muted)]">
              {t("ti-abuseipdb-key")}
            </label>
            <input
              id="abuseipdbKey"
              type="password"
              autoComplete="off"
              value={state.abuseipdbKey}
              onChange={(e) => setState((s) => ({ ...s, abuseipdbKey: e.target.value, saved: false }))}
              className="auth-input"
              placeholder={state.data.abuseipdbKeySet ? "•••••••• (configured)" : "API key (write-only)"}
            />
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {state.data.abuseipdbKeySet ? "Key configured" : "No key set"}
            </p>
          </div>

          <div className="form-field">
            <label htmlFor="otxKey" className="text-sm text-[var(--color-ink-muted)]">
              {t("ti-otx-key")}
            </label>
            <input
              id="otxKey"
              type="password"
              autoComplete="off"
              value={state.otxKey}
              onChange={(e) => setState((s) => ({ ...s, otxKey: e.target.value, saved: false }))}
              className="auth-input"
              placeholder={state.data.otxKeySet ? "•••••••• (configured)" : "API key (write-only)"}
            />
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {state.data.otxKeySet ? "Key configured" : "No key set"}
            </p>
          </div>

          <div className="form-field">
            <label htmlFor="greynoiseKey" className="text-sm text-[var(--color-ink-muted)]">
              {t("greynoise-key")}
            </label>
            <input
              id="greynoiseKey"
              type="password"
              autoComplete="off"
              value={state.greynoiseKey}
              onChange={(e) => setState((s) => ({ ...s, greynoiseKey: e.target.value, saved: false }))}
              className="auth-input"
              placeholder={state.data.greynoiseKeySet ? "•••••••• (configured)" : "API key (write-only)"}
            />
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {state.data.greynoiseKeySet ? "Key configured" : "No key set"}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="form-field">
              <label htmlFor="tiMinLevel" className="text-sm text-[var(--color-ink-muted)]">
                {t("ti-min-level")}
              </label>
              <input
                id="tiMinLevel"
                type="number"
                min={1}
                max={15}
                value={state.data.tiMinLevel}
                onChange={(e) => handleChange("tiMinLevel", e.target.value)}
                className="auth-input"
              />
            </div>
            <div className="form-field">
              <label htmlFor="tiCacheTtlDays" className="text-sm text-[var(--color-ink-muted)]">
                {t("ti-cache-ttl-days")}
              </label>
              <input
                id="tiCacheTtlDays"
                type="number"
                min={1}
                max={365}
                value={state.data.tiCacheTtlDays}
                onChange={(e) => handleChange("tiCacheTtlDays", e.target.value)}
                className="auth-input"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--color-hairline)] pt-4 space-y-4">
          <h2 className="text-sm font-semibold">{t("cooldown-title")}</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">{t("cooldown-desc")}</p>
          <div className="form-field">
            <label htmlFor="cooldownDefault" className="text-sm text-[var(--color-ink-muted)]">
              {t("cooldown-default")}
            </label>
            <input
              id="cooldownDefault"
              type="number"
              min={0}
              max={1440}
              value={state.cooldownDefault}
              onChange={(e) => setState((s) => ({ ...s, cooldownDefault: e.target.value, saved: false }))}
              className="auth-input"
            />
          </div>
          <div className="form-field">
            <label htmlFor="cooldownLines" className="text-sm text-[var(--color-ink-muted)]">
              {t("cooldown-per-rule")}
            </label>
            <textarea
              id="cooldownLines"
              rows={4}
              value={state.cooldownLines}
              onChange={(e) => setState((s) => ({ ...s, cooldownLines: e.target.value, saved: false }))}
              className="auth-input font-mono text-xs"
              placeholder="533:60&#10;40103:0"
            />
          </div>
        </div>

        <div className="border-t border-[var(--color-hairline)] pt-4 space-y-4">
          <h2 className="text-sm font-semibold">{t("analysis-scope-title")}</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">{t("analysis-scope-desc")}</p>
          <div className="form-field">
            <label htmlFor="analysisAllowTags" className="text-sm text-[var(--color-ink-muted)]">
              {t("analysis-allow-tags")}
            </label>
            <textarea
              id="analysisAllowTags"
              aria-describedby="analysisAllowHint"
              rows={4}
              value={state.allowTagsLines}
              onChange={(e) => setState((s) => ({ ...s, allowTagsLines: e.target.value, saved: false }))}
              className="auth-input font-mono text-xs"
              placeholder="T1046"
            />
            <p id="analysisAllowHint" className="text-xs text-[var(--color-ink-muted)]">{t("analysis-allow-hint")}</p>
          </div>
          <div className="form-field">
            <label htmlFor="analysisDenyTags" className="text-sm text-[var(--color-ink-muted)]">
              {t("analysis-deny-tags")}
            </label>
            <textarea
              id="analysisDenyTags"
              aria-describedby="analysisDenyHint"
              rows={4}
              value={state.denyTagsLines}
              onChange={(e) => setState((s) => ({ ...s, denyTagsLines: e.target.value, saved: false }))}
              className="auth-input font-mono text-xs"
              placeholder="T1055"
            />
            <p id="analysisDenyHint" className="text-xs text-[var(--color-ink-muted)]">{t("analysis-deny-hint")}</p>
          </div>
        </div>

        <button
          type="submit"
          disabled={state.saving}
          className="outline-button px-4 py-2 text-sm disabled:opacity-50"
        >
          {state.saving ? t("soc-saving") : t("soc-save")}
        </button>
      </form>
    </section>
  );
}
