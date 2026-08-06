"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { IncidentListItem } from "../../../server/incidents/query";

export function IncidentsClient({ canManage }: { readonly canManage: boolean }) {
  const t = useTranslations("incidents");
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [filterStatus, setFilterStatus] = useState<string>("open");
  const [correlating, setCorrelating] = useState(false);
  const [correlateMsg, setCorrelateMsg] = useState<string | null>(null);

  const load = useCallback(async (currentStatus: string) => {
    setStatus("loading");
    const params = new URLSearchParams();
    if (currentStatus !== "all") params.set("status", currentStatus);
    try {
      const response = await fetch(`/api/incidents?${params.toString()}`);
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { data: { items: IncidentListItem[]; total: number } };
      setIncidents(body.data.items);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filterStatus);
  }, [load, filterStatus]);

  const handleCorrelate = async () => {
    if (correlating || !canManage) return;
    setCorrelating(true);
    setCorrelateMsg(null);
    try {
      const res = await fetch("/api/incidents/correlate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: { checked: number; matched: number; created: number } };
      const msg = t("correlate-done", {
        checked: body.data.checked,
        matched: body.data.matched,
        created: body.data.created,
      });
      setCorrelateMsg(msg);
      void load(filterStatus);
    } catch {
      setCorrelateMsg(t("correlate-error"));
    } finally {
      setCorrelating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--color-ink)]">{t("title")}</h1>
        {canManage && (
          <div className="flex items-center gap-4">
            {correlateMsg && <span className="text-sm text-[var(--color-ink-muted)]">{correlateMsg}</span>}
            <button
              type="button"
              disabled={correlating}
              onClick={() => void handleCorrelate()}
              className="rounded-[6px] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-on-primary)] transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {correlating ? t("correlating") : t("correlate")}
            </button>
          </div>
        )}
      </header>

      <div className="flex items-center gap-2">
        {(["open", "investigating", "mitigated", "resolved", "all"] as const).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setFilterStatus(st)}
            className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors ${
              filterStatus === st
                ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                : "bg-[var(--color-canvas-soft)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {st === "all" ? t("all-statuses") : t(`status-${st}` as any)}
          </button>
        ))}
      </div>

      {status === "loading" && <p className="text-sm text-[var(--color-ink-muted)]">{t("title")}...</p>}
      {status === "error" && <p className="text-sm text-[var(--color-danger-ink)]">{t("load-error")}</p>}

      {status === "success" && incidents.length === 0 && (
        <div className="rounded-[8px] border border-[var(--color-hairline)] p-8 text-center text-sm text-[var(--color-ink-muted)]">
          {t("empty")}
        </div>
      )}

      {status === "success" && incidents.length > 0 && (
        <div className="overflow-x-auto rounded-[8px] border border-[var(--color-hairline)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] text-xs uppercase text-[var(--color-ink-muted)]">
              <tr>
                <th className="p-4">Title</th>
                <th className="p-4">{t("severity")}</th>
                <th className="p-4">Status</th>
                <th className="p-4">{t("agent")}</th>
                <th className="p-4">{t("alerts")}</th>
                <th className="p-4">{t("created")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-hairline)]">
              {incidents.map((inc) => (
                <tr key={inc.id} className="transition-colors hover:bg-[var(--color-canvas-soft)]/50">
                  <td className="p-4 font-medium text-[var(--color-ink)]">
                    <Link href={`/incidents/${inc.id}`} className="hover:underline">
                      {inc.title}
                    </Link>
                  </td>
                  <td className="p-4 text-xs font-semibold capitalize text-[var(--color-ink-muted)]">{inc.severity}</td>
                  <td className="p-4 text-xs font-medium uppercase text-[var(--color-ink-muted)]">{inc.status}</td>
                  <td className="p-4 font-mono text-xs">{inc.agentId ?? "-"}</td>
                  <td className="p-4 text-xs">{inc.alertCount}</td>
                  <td className="p-4 text-xs text-[var(--color-ink-muted)]">
                    {new Date(inc.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
