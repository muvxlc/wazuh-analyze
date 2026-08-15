"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { EvidenceRecord } from "../../server/evidence/service";

const EVIDENCE_TYPES: EvidenceRecord["evidenceType"][] = [
  "ioc",
  "log",
  "note",
  "network",
  "threat_intel",
];

const TYPE_LABELS: Record<EvidenceRecord["evidenceType"], string> = {
  ioc: "IOC",
  log: "Log",
  note: "Note",
  network: "Network",
  threat_intel: "Threat Intel",
};

interface Props {
  readonly incidentId: string;
  readonly canManage: boolean;
}

interface ApiError {
  code?: string;
  message?: string;
  requestId?: string;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "-";
  return new Date(d).toLocaleString();
}

export function IncidentEvidencePanel({ incidentId, canManage }: Props) {
  const t = useTranslations("incidents");
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [evidenceType, setEvidenceType] = useState<EvidenceRecord["evidenceType"]>("ioc");
  const [content, setContent] = useState("");
  const [provenanceEndpoint, setProvenanceEndpoint] = useState("");
  const [eventAt, setEventAt] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/evidence?incidentId=${encodeURIComponent(incidentId)}`)
      .then((r) => {
        if (!r.ok) throw new Error("fetch-failed");
        return r.json();
      })
      .then((body: { data: EvidenceRecord[] }) => {
        if (alive) {
          setEvidence(body.data ?? []);
          setApiError(null);
        }
      })
      .catch(() => {
        if (alive) setApiError(t("evidence-load-failed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [incidentId, t]);

  const resetForm = () => {
    setTitle("");
    setEvidenceType("ioc");
    setContent("");
    setProvenanceEndpoint("");
    setEventAt("");
    setFormErr(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting || !canManage) return;
    setFormErr(null);
    setApiError(null);
    setSubmitting(true);
    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      setFormErr(t("evidence-content-invalid-json"));
      setSubmitting(false);
      return;
    }
    const body: Record<string, unknown> = {
      incidentId,
      evidenceType,
      title: title.trim(),
      content: parsedContent,
    };
    if (provenanceEndpoint.trim()) body.provenanceEndpoint = provenanceEndpoint.trim();
    if (eventAt) body.eventAt = new Date(eventAt).toISOString();
    try {
      const res = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json()) as { error: ApiError };
        if (res.status === 400 && errBody.error?.code === "invalid_input") {
          setApiError(errBody.error.message ?? errBody.error.code ?? t("evidence-create-failed"));
        } else {
          setApiError(t("evidence-create-failed"));
        }
        return;
      }
      const body2 = (await res.json()) as { data: EvidenceRecord };
      setEvidence((prev) => [body2.data, ...prev]);
      resetForm();
    } catch {
      setApiError(t("evidence-create-failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-[8px] border border-[var(--color-hairline)] p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {t("evidence-title")}
      </h2>

      {apiError && (
        <div className="mb-4 rounded-[6px] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-ink)]">
          {apiError}
        </div>
      )}
      {formErr && (
        <div className="mb-4 rounded-[6px] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-ink)]">
          {formErr}
        </div>
      )}

      <div className="flex flex-col gap-3 mb-6">
        {loading ? (
          <div className="text-xs text-[var(--color-ink-muted)]">{t("evidence-loading")}</div>
        ) : evidence.length === 0 ? (
          <div className="text-xs text-[var(--color-ink-muted)]">{t("evidence-no-items")}</div>
        ) : (
          evidence.map((item) => (
            <div
              key={item.id}
              className="rounded bg-[var(--color-canvas-subtle)] p-3 border border-[var(--color-hairline)]"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-block rounded bg-[var(--color-primary-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                  {TYPE_LABELS[item.evidenceType]}
                </span>
                <span className="text-sm font-semibold text-[var(--color-ink)]">{item.title}</span>
                {item.validated && (
                  <span className="inline-block rounded bg-[var(--color-success-bg)] px-2 py-0.5 text-xs text-[var(--color-success)]">
                    {t("evidence-validated")}
                  </span>
                )}
              </div>
              {item.content !== null && item.content !== undefined && (
                <pre className="mt-2 break-all text-xs font-mono text-[var(--color-ink-muted)] whitespace-pre-wrap">
                  {typeof item.content === "string"
                    ? item.content
                    : JSON.stringify(item.content, null, 2)}
                </pre>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                {item.eventAt && (
                  <span>{t("evidence-event-at")}: <strong className="text-[var(--color-ink)]">{fmtDate(item.eventAt)}</strong></span>
                )}
                <span>{t("evidence-created-at")}: <strong className="text-[var(--color-ink)]">{fmtDate(item.createdAt)}</strong></span>
                {item.provenanceEndpoint && (
                  <span className="max-w-[200px] truncate font-mono">{item.provenanceEndpoint}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {canManage && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-4 border-t border-[var(--color-hairline)]">
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">{t("evidence-add-title")}</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("evidence-title-placeholder")}
              required
              maxLength={512}
              className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              disabled={submitting}
            />
            <select
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value as EvidenceRecord["evidenceType"])}
              className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              disabled={submitting}
            >
              {EVIDENCE_TYPES.map((type) => (
                <option key={type} value={type}>{TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("evidence-content-placeholder")}
            className="w-full rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] min-h-[80px] font-mono"
            disabled={submitting}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              type="text"
              value={provenanceEndpoint}
              onChange={(e) => setProvenanceEndpoint(e.target.value)}
              placeholder={t("evidence-provenance-placeholder")}
              maxLength={2048}
              className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              disabled={submitting}
            />
            <input
              type="datetime-local"
              value={eventAt}
              onChange={(e) => setEventAt(e.target.value)}
              className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              disabled={submitting}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="self-end rounded-[6px] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? t("evidence-adding") : t("evidence-add-btn")}
          </button>
        </form>
      )}
    </section>
  );
}
