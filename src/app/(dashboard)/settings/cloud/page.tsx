"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface CloudSettings {
  wazuhApiUrl: string;
  wazuhUsernameSet: boolean;
  wazuhAllowInsecureTls: boolean;
  wazuhPasswordSet: boolean;
  wazuhCaPath: string | null;
}

interface State {
  data: CloudSettings | null;
  saving: boolean;
  error: string | null;
  saved: boolean;
  username: string;
  password: string;
}

export default function SettingsCloudPage() {
  const t = useTranslations("settings");
  const [state, setState] = useState<State>({
    data: null,
    saving: false,
    error: null,
    saved: false,
    username: "",
    password: "",
  });

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((b: { data: CloudSettings }) =>
        setState((s) => ({
          ...s,
          data: b.data,
          error: null,
          saved: false,
          username: "",
          password: "",
        })),
      )
      .catch(() => setState((s) => ({ ...s, error: t("fetch-error") })));
  }, [t]);

  const handleChange = (
    field: keyof CloudSettings,
    value: string | boolean,
  ) => {
    setState((s) => ({
      ...s,
      data: s.data ? { ...s.data, [field]: value } : null,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.data) return;
    setState((s) => ({ ...s, saving: true, error: null, saved: false }));
    try {
      const body: Record<string, unknown> = {
        wazuhApiUrl: state.data.wazuhApiUrl,
        wazuhCaPath: state.data.wazuhCaPath ?? "",
        wazuhAllowInsecureTls: state.data.wazuhAllowInsecureTls,
      };
      if (state.username) body.wazuhUsername = state.username;
      if (state.password) body.wazuhPassword = state.password;
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const b = (await res.json()) as { data: CloudSettings };
      setState((s) => ({
        ...s,
        saving: false,
        saved: true,
        data: b.data,
        username: "",
        password: "",
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
          <h1>{t("cloud")}</h1>
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
          <h1>{t("cloud")}</h1>
        </header>
        <p className="panel p-4" role="status">{t("loading")}</p>
      </section>
    );
  }

  return (
    <section className="page-section space-y-6">
      <header>
        <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">Settings</p>
        <h1>{t("cloud")}</h1>
      </header>
      <form onSubmit={handleSubmit} className="panel p-6 space-y-4">
        {state.saved && (
          <p className="text-sm text-green-600" role="status">
            {t("cloud-save-success")}
          </p>
        )}
        {state.error && <p className="status-error p-3">{state.error}</p>}
        <div className="form-field">
          <label
            htmlFor="wazuhApiUrl"
            className="text-sm text-[var(--color-ink-muted)]"
          >
            {t("cloud-wazuh-api-url")}
          </label>
          <input
            id="wazuhApiUrl"
            type="url"
            className="auth-input"
            value={state.data.wazuhApiUrl}
            onChange={(e) => handleChange("wazuhApiUrl", e.target.value)}
            placeholder={t("cloud-wazuh-url-placeholder")}
          />
        </div>
        <div className="form-field">
          <label
            htmlFor="wazuhUsername"
            className="text-sm text-[var(--color-ink-muted)]"
          >
            {t("cloud-wazuh-username")}
          </label>
          <input
            id="wazuhUsername"
            type="text"
            className="auth-input"
            value={state.username}
            onChange={(e) =>
              setState((s) => ({ ...s, username: e.target.value }))
            }
            placeholder={t("cloud-wazuh-username-placeholder")}
          />
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            {state.data.wazuhUsernameSet
              ? t("cloud-username-set")
              : t("cloud-username-not-set")}
          </p>
        </div>
        <div className="form-field">
          <label
            htmlFor="wazuhPassword"
            className="text-sm text-[var(--color-ink-muted)]"
          >
            {t("cloud-wazuh-password")}
          </label>
          <input
            id="wazuhPassword"
            type="password"
            autoComplete="off"
            className="auth-input"
            placeholder={t("cloud-wazuh-password-placeholder")}
            value={state.password}
            onChange={(e) =>
              setState((s) => ({ ...s, password: e.target.value }))
            }
          />
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            {state.data.wazuhPasswordSet
              ? t("cloud-password-set")
              : t("cloud-password-not-set")}
          </p>
        </div>
        <div className="form-field">
          <label
            htmlFor="wazuhCaPath"
            className="text-sm text-[var(--color-ink-muted)]"
          >
            {t("cloud-wazuh-ca-path")}
          </label>
          <input
            id="wazuhCaPath"
            type="text"
            className="auth-input"
            value={state.data.wazuhCaPath ?? ""}
            onChange={(e) => handleChange("wazuhCaPath", e.target.value)}
            placeholder={t("cloud-wazuh-ca-path-placeholder")}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="wazuhAllowInsecureTls"
            type="checkbox"
            checked={state.data.wazuhAllowInsecureTls}
            onChange={(e) =>
              handleChange("wazuhAllowInsecureTls", e.target.checked)
            }
          />
          <label
            htmlFor="wazuhAllowInsecureTls"
            className="text-sm text-[var(--color-ink-muted)]"
          >
            {t("cloud-wazuh-allow-insecure-tls")}
          </label>
        </div>
        <button
          type="submit"
          disabled={state.saving}
          className="outline-button px-4 py-2 text-sm disabled:opacity-50"
        >
          {state.saving ? t("cloud-saving") : t("cloud-save")}
        </button>
      </form>
    </section>
  );
}
