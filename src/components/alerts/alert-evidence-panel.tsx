"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

export interface EvidenceRecord {
  id: string;
  alertId: string | null;
  incidentId: string | null;
  evidenceType: "ioc" | "log" | "note" | "network" | "threat_intel";
  title: string;
  content: unknown;
  provenanceEndpoint: string | null;
  eventAt: string | null;
  retrievedAt: string;
  contentHash: string;
  contentSize: number;
  validated: boolean;
  validatedByUserId: string | null;
  validatedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

interface AlertEvidencePanelProps {
  alertId: string;
}

const EVIDENCE_TYPE_LABELS: Record<EvidenceRecord["evidenceType"], string> = {
  ioc: "IOC",
  log: "Log",
  note: "Note",
  network: "Network",
  threat_intel: "Threat Intel",
};

export function AlertEvidencePanel({ alertId }: AlertEvidencePanelProps) {
  const t = useTranslations("alerts.evidence");
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    evidenceType: EvidenceRecord["evidenceType"];
    title: string;
    content: string;
    provenanceEndpoint: string;
    eventAt: string;
  }>({
    evidenceType: "ioc",
    title: "",
    content: "",
    provenanceEndpoint: "",
    eventAt: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/evidence?alertId=${encodeURIComponent(alertId)}`);
        if (!res.ok) throw new Error(String(res.status));
        const result = (await res.json()) as { data: EvidenceRecord[] };
        if (!cancelled) setRecords(result.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "unknown");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [alertId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!form.title.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(form.content);
    } catch {
      setSubmitError(t("form.invalidJson"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alertId,
          evidenceType: form.evidenceType,
          title: form.title.trim(),
          content: parsed,
          provenanceEndpoint: form.provenanceEndpoint.trim() || null,
          eventAt: form.eventAt || null,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
        throw new Error(payload.error?.message ?? payload.error?.code ?? `Request failed (${res.status})`);
      }
      const result = (await res.json()) as { data: EvidenceRecord };
      setRecords((prev) => [result.data, ...prev]);
      setForm({ evidenceType: "ioc", title: "", content: "", provenanceEndpoint: "", eventAt: "" });
      setShowForm(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleChange(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) {
    return (
      <section className="panel detail-section mt-4">
        <h3 className="m-0 mb-2 text-sm font-medium">{t("title")}</h3>
        <p className="muted">{t("loading")}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel detail-section mt-4">
        <h3 className="m-0 mb-2 text-sm font-medium">{t("title")}</h3>
        <p style={{ color: "var(--color-danger)", marginBottom: "0.5rem" }}>{t("error")}: {error}</p>
        <button type="button" className="outline-button" onClick={() => void (async () => { setLoading(true); setError(null); try { const res = await fetch(`/api/evidence?alertId=${encodeURIComponent(alertId)}`); if (res.ok) { const r = await res.json(); setRecords(r.data ?? []); } } finally { setLoading(false); } })()}>
          {t("retry")}
        </button>
      </section>
    );
  }

  return (
    <section className="panel detail-section" data-testid="alert-evidence-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 className="m-0 text-sm font-medium">{t("title")}</h3>
        <button type="button" className="outline-button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "— " : "+ "}
          {t("addEvidence")}
        </button>
      </div>

      {records.length === 0 && (
        <p className="muted">{t("noEvidence")}</p>
      )}

      <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
        {records.map((rec) => (
          <li key={rec.id} style={{ marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <strong>{rec.title}</strong>
              <span className="group-badge">{EVIDENCE_TYPE_LABELS[rec.evidenceType]}</span>
              {rec.validated && <span className="group-badge" style={{ backgroundColor: "var(--color-success)", color: "var(--color-on-dark)" }}>{t("validated")}</span>}
              <span className="muted" style={{ fontSize: "12px" }}>
                {rec.eventAt ? `${t("eventAt")}: ${rec.eventAt}` : `${t("createdAt")}: ${rec.createdAt}`}
              </span>
            </div>
            {typeof rec.content === "object" && rec.content !== null && !Array.isArray(rec.content) && (
              <pre style={{ margin: "0.25rem 0 0", fontSize: "12px", padding: "0.5rem", background: "var(--color-canvas-soft)", borderRadius: "4px", overflowX: "auto" }}>
                {JSON.stringify(rec.content, null, 2)}
              </pre>
            )}
            {rec.provenanceEndpoint && (
              <p className="muted" style={{ margin: "0.125rem 0 0", fontSize: "12px" }}>
                {rec.provenanceEndpoint}
              </p>
            )}
          </li>
        ))}
      </ol>

      {showForm && (
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label className="text-sm" htmlFor="ev-type">{t("form.type")}</label>
            <select id="ev-type" className="auth-input" value={form.evidenceType} onChange={(e) => handleChange("evidenceType", e.target.value)}>
              {(Object.keys(EVIDENCE_TYPE_LABELS) as EvidenceRecord["evidenceType"][]).map((k) => (
                <option key={k} value={k}>{EVIDENCE_TYPE_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label className="text-sm" htmlFor="ev-title">{t("form.title")}</label>
            <input id="ev-title" className="auth-input" type="text" value={form.title} onChange={(e) => handleChange("title", e.target.value)} maxLength={512} required />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label className="text-sm" htmlFor="ev-content">{t("form.content")}</label>
            <textarea id="ev-content" className="auth-input" rows={4} value={form.content} onChange={(e) => handleChange("content", e.target.value)} placeholder='{"key": "value"}' />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label className="text-sm" htmlFor="ev-provenance">{t("form.provenance")}</label>
            <input id="ev-provenance" className="auth-input" type="text" value={form.provenanceEndpoint} onChange={(e) => handleChange("provenanceEndpoint", e.target.value)} maxLength={2048} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label className="text-sm" htmlFor="ev-eventAt">{t("form.eventAt")}</label>
            <input id="ev-eventAt" className="auth-input" type="datetime-local" value={form.eventAt} onChange={(e) => handleChange("eventAt", e.target.value)} />
          </div>
          {submitError && (
            <p role="alert" style={{ color: "var(--color-danger)", fontSize: "0.875rem", margin: 0 }}>{submitError}</p>
          )}
          <button type="submit" className="btn-primary" disabled={submitting || !form.title.trim()}>
            {submitting ? "…" : t("form.submit")}
          </button>
        </form>
      )}
    </section>
  );
}
