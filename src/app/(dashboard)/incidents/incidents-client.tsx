"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { IncidentListItem } from "../../../server/incidents/query";
import { SEVERITY_COLORS, severityLabel } from "../../../server/alerts/severity-mapper";

const PAGE_SIZE = 20;
const STATUS_TABS = ["open", "investigating", "mitigated", "resolved", "all"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

function incidentSeverity(sev: string) {
  const key = sev.toLowerCase();
  return key === "critical" || key === "high" || key === "medium" || key === "low" ? key : "low";
}

export function IncidentsClient({
  canManage,
  initialStatus = "open",
}: {
  readonly canManage: boolean;
  readonly initialStatus?: string;
}) {
  const t = useTranslations("incidents");
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [filterStatus, setFilterStatus] = useState<string>(initialStatus);
  const [filterSeverity, setFilterSeverity] = useState<string>("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [correlating, setCorrelating] = useState(false);
  const [correlateMsg, setCorrelateMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; displayName: string; isActive?: boolean }>>([]);

  // Load active users once for the bulk-assign dropdown.
  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    fetch("/api/users")
      .then((r) => r.json())
      .then((body: { data: { users: Array<{ id: string; displayName: string; isActive?: boolean }> } }) => {
        if (alive) setUsers(body.data.users.filter((u) => u.isActive !== false));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [canManage]);

  // Debounce search input so typing does not hammer the API.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(async (currentStatus: string, currentSeverity: string, term: string, currentOffset: number) => {
    setStatus("loading");
    const params = new URLSearchParams();
    if (currentStatus !== "all") params.set("status", currentStatus);
    if (currentSeverity) params.set("severity", currentSeverity);
    if (term) params.set("q", term);
    if (currentOffset > 0) {
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(currentOffset));
    } else {
      params.set("limit", String(PAGE_SIZE));
    }
    try {
      const response = await fetch(`/api/incidents?${params.toString()}`);
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { data: { items: IncidentListItem[]; total: number } };
      setIncidents(body.data.items);
      setTotal(body.data.total);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filterStatus, filterSeverity, debouncedSearch, offset);
  }, [load, filterStatus, filterSeverity, debouncedSearch, offset]);

  const handleStatus = (st: string) => {
    setFilterStatus(st);
    setOffset(0);
  };
  const handleSeverity = (sev: string) => {
    setFilterSeverity(sev);
    setOffset(0);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) =>
      prev.size === incidents.length && incidents.every((i) => prev.has(i.id))
        ? new Set()
        : new Set(incidents.map((i) => i.id)),
    );
  };

  const handleBulk = async (payload: { to?: string; assigneeUserId?: string | null }) => {
    if (bulkBusy || selected.size === 0) return;
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const res = await fetch("/api/incidents/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], ...payload }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: { succeeded: number; failed: number } };
      setBulkMsg(t("bulk-done", { succeeded: body.data.succeeded, failed: body.data.failed }));
      setSelected(new Set());
      void load(filterStatus, filterSeverity, debouncedSearch, offset);
    } catch {
      setBulkMsg(t("bulk-error"));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterSeverity) params.set("severity", filterSeverity);
    if (debouncedSearch) params.set("q", debouncedSearch);
    window.location.href = `/api/incidents/export?${params.toString()}`;
  };

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
      void load(filterStatus, filterSeverity, debouncedSearch, offset);
    } catch {
      setCorrelateMsg(t("correlate-error"));
    } finally {
      setCorrelating(false);
    }
  };

  const canPrev = offset > 0;
  const canNext = offset + incidents.length < total;
  const pageFrom = total === 0 ? 0 : offset + 1;
  const pageTo = offset + incidents.length;

  const showResolvedHint = useMemo(
    () => filterStatus === "resolved" || filterStatus === "all",
    [filterStatus],
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--color-ink)]">{t("title")}</h1>
        <div className="flex items-center gap-4">
          {correlateMsg && <span className="text-sm text-[var(--color-ink-muted)]">{correlateMsg}</span>}
          <button
            type="button"
            onClick={() => handleExport()}
            className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-canvas-soft)]"
          >
            {t("export")}
          </button>
          {canManage && (
            <button
              type="button"
              disabled={correlating}
              onClick={() => void handleCorrelate()}
              className="rounded-[6px] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-on-primary)] transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {correlating ? t("correlating") : t("correlate")}
            </button>
          )}
        </div>
      </header>

      {canManage && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-primary)] bg-[var(--color-canvas-soft)] p-3">
          <span className="text-xs font-semibold text-[var(--color-ink)]">
            {t("bulk-selected", { count: selected.size })}
          </span>
          {(["investigating", "mitigated", "resolved", "open"] as const).map((st) => (
            <button
              key={st}
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleBulk({ to: st })}
              className="rounded-[6px] bg-[var(--color-canvas)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-hairline)] disabled:opacity-50"
            >
              {t(`status-${st}` as any)}
            </button>
          ))}
          <select
            value=""
            onChange={(e) => { if (e.target.value) void handleBulk({ assigneeUserId: e.target.value }); }}
            disabled={bulkBusy}
            aria-label={t("assignee")}
            className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-2 py-1 text-xs text-[var(--color-ink)] disabled:opacity-50"
          >
            <option value="">{t("bulk-assign")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-[6px] px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            {t("bulk-clear")}
          </button>
          {bulkMsg && <span className="text-xs text-[var(--color-ink-muted)]">{bulkMsg}</span>}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => handleStatus(st)}
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

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search-placeholder")}
            aria-label={t("search")}
            className="min-w-[200px] flex-1 rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-1.5 text-sm text-[var(--color-ink)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
          <select
            value={filterSeverity}
            onChange={(e) => handleSeverity(e.target.value)}
            aria-label={t("filter-severity")}
            className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-1.5 text-xs text-[var(--color-ink)] focus:border-[var(--color-primary)] focus:outline-none"
          >
            <option value="">{t("all-severities")}</option>
            {SEVERITIES.map((sev) => (
              <option key={sev} value={sev}>
                {severityLabel(sev)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showResolvedHint && (
        <p className="text-xs text-[var(--color-ink-muted)]">{t("resolved-hint")}</p>
      )}

      {status === "loading" && <p className="text-sm text-[var(--color-ink-muted)]">{t("loading")}</p>}
      {status === "error" && <p className="text-sm text-[var(--color-danger-ink)]">{t("load-error")}</p>}

      {status === "success" && incidents.length === 0 && (
        <div className="rounded-[8px] border border-[var(--color-hairline)] p-8 text-center text-sm text-[var(--color-ink-muted)]">
          {t("empty")}
        </div>
      )}

      {status === "success" && incidents.length > 0 && (
        <div className="table-scroll">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--color-hairline)] bg-[var(--color-canvas-soft)] text-xs uppercase text-[var(--color-ink-muted)]">
              <tr>
                {canManage && (
                  <th className="w-10 p-4">
                    <input
                      type="checkbox"
                      aria-label={t("bulk-select-all")}
                      checked={incidents.length > 0 && incidents.every((i) => selected.has(i.id))}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                <th className="p-4">{t("title")}</th>
                <th className="p-4">{t("severity")}</th>
                <th className="p-4">{t("transition")}</th>
                <th className="p-4">{t("agent")}</th>
                <th className="p-4">{t("alerts")}</th>
                <th className="p-4">{t("created")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-hairline)]">
              {incidents.map((inc) => (
                <tr key={inc.id} className="transition-colors hover:bg-[var(--color-canvas-soft)]/50">
                  {canManage && (
                    <td className="w-10 p-4">
                      <input
                        type="checkbox"
                        aria-label={t("bulk-select")}
                        checked={selected.has(inc.id)}
                        onChange={() => toggleSelect(inc.id)}
                      />
                    </td>
                  )}
                  <td className="p-4 font-medium text-[var(--color-ink)]">
                    <Link href={`/incidents/${inc.id}`} className="hover:underline">
                      {inc.incidentNumber ? `[${inc.incidentNumber}] ` : ""}{inc.title}
                    </Link>
                  </td>
                  <td className="p-4">
                    <span
                      className="severity-badge"
                      aria-label={`${t("severity")} ${incidentSeverity(inc.severity)}`}
                      style={{
                        backgroundColor: SEVERITY_COLORS[incidentSeverity(inc.severity)],
                        color: "var(--color-on-dark)",
                      }}
                    >
                      {severityLabel(incidentSeverity(inc.severity))}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`status-pill status-${inc.status}`}>
                      {t(`status-${inc.status}` as any)}
                    </span>
                  </td>
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

      {status === "success" && total > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-[var(--color-ink-muted)]">
            {t("page-info", { from: pageFrom, to: pageTo, total })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-canvas-soft)] disabled:opacity-50"
            >
              {t("page-prev")}
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-canvas-soft)] disabled:opacity-50"
            >
              {t("page-next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
