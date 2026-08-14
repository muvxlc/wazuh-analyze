"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { IncidentDetail, IncidentStatus } from "../../server/incidents/types";
import { getIncidentTransitionMatrix } from "../../server/incidents/workflow";
import { SEVERITY_COLORS, severityLabel } from "../../server/alerts/severity-mapper";
import { UndoToast } from "../ui/undo-toast";
import { IncidentActions } from "./incident-actions";
import { IncidentNotes } from "./incident-notes";

interface Props {
  readonly initialIncident: IncidentDetail;
  readonly canManage: boolean;
  readonly canApprove: boolean;
}

interface UserOption {
  readonly id: string;
  readonly displayName: string;
}

const MATRIX = getIncidentTransitionMatrix();

function incidentSeverity(sev: string) {
  const key = sev.toLowerCase();
  return key === "critical" || key === "high" || key === "medium" || key === "low" ? key : "low";
}

// ponytail: single-column reactive detail view with direct transition triggers, omitting bloated tab navigations.
export function IncidentDetailView({ initialIncident, canManage, canApprove }: Props) {
  const t = useTranslations("incidents");
  const [incident, setIncident] = useState<IncidentDetail>(initialIncident);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [undo, setUndo] = useState<{ prev: IncidentStatus } | null>(null);

  // Load active users once for the assign dropdown (manage-only).
  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    fetch("/api/users")
      .then((r) => r.json())
      .then((body: { data: { users: UserOption[] } }) => {
        if (alive) setUsers(body.data.users.filter((u) => (u as UserOption & { isActive?: boolean }).isActive !== false));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [canManage]);

  const availableTargets: IncidentStatus[] = Object.entries(MATRIX)
    .filter(([_, conf]) => conf.validFrom.includes(incident.status))
    .map(([target]) => target as IncidentStatus);

  const handleTransition = async (target: IncidentStatus) => {
    if (updating || !canManage) return;
    const prev = incident.status;
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
      setUndo({ prev });
    } catch {
      setError(t("transition-failed"));
    } finally {
      setUpdating(false);
    }
  };

  const handleUndo = async () => {
    if (!undo) return;
    const prev = undo.prev;
    setUndo(null);
    try {
      const res = await fetch(`/api/incidents/${incident.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: prev }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: IncidentDetail };
      setIncident(body.data);
    } catch {
      // ponytail: matrix is not fully reversible (e.g. resolved→mitigated invalid); reload to reflect truth.
      setError(t("transition-failed"));
    }
  };

  const handleAssign = async (assigneeUserId: string | null) => {
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${incident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: IncidentDetail };
      setIncident(body.data);
    } catch {
      setError(t("transition-failed"));
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
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: IncidentDetail };
      setIncident(body.data);
      setDraftMessage(t("ir-created", { number: body.data.incidentNumber ?? "" }));
    } catch {
      setDraftMessage(t("ir-create-failed"));
    } finally {
      setDrafting(false);
    }
  };

  const sevKey = incidentSeverity(incident.severity);

  return (
    <article className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-hairline)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 flex-1 break-words text-xl font-bold text-[var(--color-ink)]">
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
                {drafting ? t("creating-ir") : t("create-ir")}
              </button>
            )}
            <span className={`status-pill status-${incident.status}`}>
              {t(`status-${incident.status}` as any)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-ink-muted)]">
          <span>
            {t("severity")}:{" "}
            <span
              className="severity-badge"
              style={{ backgroundColor: SEVERITY_COLORS[sevKey], color: "var(--color-on-dark)" }}
            >
              {severityLabel(sevKey)}
            </span>
          </span>
          <span>{t("agent")}: <strong className="font-mono text-[var(--color-ink)]">{incident.agentId ?? "-"}</strong></span>
          <span>{t("rule")}: <strong className="font-mono text-[var(--color-ink)]">{incident.ruleId ?? "-"}</strong></span>
          <span className="flex items-center gap-1">
            {t("assignee")}:
            {canManage ? (
              <select
                value={incident.assigneeUserId ?? ""}
                onChange={(e) => void handleAssign(e.target.value || null)}
                disabled={updating}
                aria-label={t("assignee")}
                className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-2 py-0.5 text-xs text-[var(--color-ink)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
              >
                <option value="">{t("unassigned")}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.displayName}</option>
                ))}
              </select>
            ) : (
              <strong className="text-[var(--color-ink)]">{incident.assigneeDisplayName ?? incident.assigneeUserId ?? t("unassigned")}</strong>
            )}
          </span>
          <span>{t("created")}: <strong className="text-[var(--color-ink)]">{new Date(incident.createdAt).toLocaleString()}</strong></span>
          <span>{t("updated")}: <strong className="text-[var(--color-ink)]">{new Date(incident.updatedAt).toLocaleString()}</strong></span>
          {incident.closedAt && (
            <span>{t("closed")}: <strong className="text-[var(--color-ink)]">{new Date(incident.closedAt).toLocaleString()}</strong></span>
          )}
        </div>
        {draftMessage && (
          <p className={`text-xs mt-2 ${draftMessage === t("ir-create-failed") ? "text-[var(--color-danger-ink)]" : "text-[var(--color-success)]"}`}>
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
                <Link href={`/alerts/${alt.alertId}`} className="break-all font-mono text-xs text-[var(--color-primary)] hover:underline">
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
              <li key={ev.id} className="flex flex-col gap-0.5 py-2 text-xs">
                <span className="font-semibold uppercase text-[var(--color-ink)]">
                  {ev.fromStatus
                    ? `${t("timeline-from")} ${t(`status-${ev.fromStatus}` as any)} ${t("timeline-to")} ${t(`status-${ev.toStatus}` as any)}`
                    : `${t("timeline-to")} ${t(`status-${ev.toStatus}` as any)}`}
                </span>
                <span className="text-[var(--color-ink-muted)]">
                  {new Date(ev.occurredAt).toLocaleString()}
                  {ev.actorUserId ? ` · ${t("timeline-by")} ${ev.actorDisplayName ?? ev.actorUserId}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {undo && (
        <UndoToast
          message={t("undo-transition", { status: t(`status-${undo.prev}` as any) })}
          undoLabel={t("undo")}
          dismissLabel={t("dismiss")}
          onUndo={() => void handleUndo()}
          onClose={() => setUndo(null)}
        />
      )}
    </article>
  );
}
