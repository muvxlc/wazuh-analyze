"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { IncidentDetail, IncidentStatus } from "../../server/incidents/types";
import { getIncidentTransitionMatrix } from "../../server/incidents/workflow";
import { IncidentActions } from "./incident-actions";
import { IncidentNotes } from "./incident-notes";

interface Props {
  readonly initialIncident: IncidentDetail;
  readonly canManage: boolean;
  readonly canApprove: boolean;
}

const MATRIX = getIncidentTransitionMatrix();

// ponytail: single-column reactive detail view with direct transition triggers, omitting bloated tab navigations.
export function IncidentDetailView({ initialIncident, canManage, canApprove }: Props) {
  const t = useTranslations("incidents");
  const [incident, setIncident] = useState<IncidentDetail>(initialIncident);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);

  const availableTargets: IncidentStatus[] = Object.entries(MATRIX)
    .filter(([_, conf]) => conf.validFrom.includes(incident.status))
    .map(([target]) => target as IncidentStatus);

  const handleTransition = async (target: IncidentStatus) => {
    if (updating || !canManage) return;
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${incident.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: target }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: IncidentDetail };
      setIncident(body.data);
    } catch {
      setError(t("load-error"));
    } finally {
      setUpdating(false);
    }
  };

  const handleDraftIr = async () => {
    if (drafting || !canManage) return;
    setDrafting(true);
    setDraftMessage(null);
    try {
      const res = await fetch(`/api/incidents/${incident.id}/draft`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to draft IR report");
      const body = (await res.json()) as { data: IncidentDetail };
      setIncident(body.data);
      setDraftMessage("IR Case Drafted successfully");
    } catch (err) {
      setDraftMessage(err instanceof Error ? err.message : "Error drafting case");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <article className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-hairline)] p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-[var(--color-ink)]">
            {incident.incidentNumber ? `[${incident.incidentNumber}] ` : ""}{incident.title}
          </h1>
          <div className="flex items-center gap-3">
            {!incident.incidentNumber && canManage && (
              <button
                type="button"
                disabled={drafting}
                onClick={() => void handleDraftIr()}
                className="rounded-[6px] bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-on-primary)] hover:opacity-90 disabled:opacity-50"
              >
                {drafting ? "Drafting..." : "Create IR Case (AI)"}
              </button>
            )}
            <span className="rounded-[6px] bg-[var(--color-canvas-soft)] px-3 py-1 text-xs font-semibold uppercase text-[var(--color-ink-muted)]">
              {incident.status}
            </span>
          </div>
        </div>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {t("severity")}: <strong className="capitalize text-[var(--color-ink)]">{incident.severity}</strong> · {t("created")}: {new Date(incident.createdAt).toLocaleString()}
        </p>
        {draftMessage && (
          <p className={`text-xs mt-2 ${draftMessage.startsWith("Error") ? "text-[var(--color-danger-ink)]" : "text-green-600"}`}>
            {draftMessage}
          </p>
        )}
      </header>

      {canManage && availableTargets.length > 0 && (
        <section className="flex items-center gap-3 rounded-[8px] border border-[var(--color-hairline)] p-4">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">{t("transition")}:</span>
          <div className="flex gap-2">
            {availableTargets.map((st) => (
              <button
                key={st}
                type="button"
                disabled={updating}
                onClick={() => void handleTransition(st)}
                className="rounded-[6px] bg-[var(--color-canvas-soft)] px-3 py-1.5 text-xs font-semibold uppercase text-[var(--color-ink)] hover:bg-[var(--color-hairline)] disabled:opacity-50"
              >
                {t(`status-${st}` as any)}
              </button>
            ))}
          </div>
          {error && <span className="text-xs text-[var(--color-danger-ink)]">{error}</span>}
        </section>
      )}

      <IncidentActions incidentId={incident.id} canApprove={canApprove} />

      <IncidentNotes incidentId={incident.id} canManage={canManage} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-[8px] border border-[var(--color-hairline)] p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            {t("linked-alerts")} ({incident.alerts?.length ?? 0})
          </h2>
          <ul className="divide-y divide-[var(--color-hairline)] text-sm">
            {(incident.alerts ?? []).map((alt) => (
              <li key={alt.alertId} className="py-2">
                <Link href={`/alerts/${alt.alertId}`} className="font-mono text-xs text-[var(--color-primary)] hover:underline">
                  {alt.alertId}
                </Link>
              </li>
            ))}
            {(incident.alerts ?? []).length === 0 && <li className="text-xs text-[var(--color-ink-muted)]">-</li>}
          </ul>
        </section>

        <section className="rounded-[8px] border border-[var(--color-hairline)] p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            {t("timeline")}
          </h2>
          <ol className="divide-y divide-[var(--color-hairline)] text-sm">
            {incident.timeline.map((ev) => (
              <li key={ev.id} className="flex justify-between py-2 text-xs">
                <span className="font-semibold uppercase text-[var(--color-ink)]">{ev.toStatus}</span>
                <span className="text-[var(--color-ink-muted)]">{new Date(ev.occurredAt).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </article>
  );
}
