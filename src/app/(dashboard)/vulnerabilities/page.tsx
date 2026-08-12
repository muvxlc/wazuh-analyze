"use client";

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert, AlertTriangle, AlertCircle, Info, RefreshCw, Settings } from "lucide-react";
import Link from "next/link";

interface VulnItem {
  cve: string;
  title?: string;
  severity: string;
  cvss_score?: number;
  condition?: string;
  status: string;
  published?: string;
  agentId: string;
  agentName: string;
}

interface AgentInfo {
  id: string;
  name: string;
}

interface PageState {
  vulnerabilities: VulnItem[];
  agents: AgentInfo[];
  indexerConfigured: boolean;
  indexerError?: boolean;
  stale: boolean;
  upstreamErrorCode?: string;
}

function normSeverity(sev: string): string {
  const n = sev.charAt(0).toUpperCase() + sev.slice(1).toLowerCase();
  return { Critical: "critical", High: "high", Medium: "medium", Low: "low" }[n] ?? "info";
}

function getSeverityIcon(sev: string) {
  const key = normSeverity(sev);
  const map: Record<string, typeof AlertTriangle> = {
    critical: ShieldAlert,
    high: ShieldAlert,
    medium: AlertTriangle,
    low: AlertCircle,
  };
  return map[key] ?? Info;
}

function getSeverityColorClass(sev: string): string {
  const key = normSeverity(sev);
  const cls: Record<string, string> = {
    critical: "bg-red-100 text-red-700",
    high: "bg-orange-100 text-orange-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-blue-100 text-blue-700",
    info: "bg-gray-100 text-gray-500",
  };
  return cls[key] ?? cls.info;
}

function cvssColorClass(score: number): string {
  if (score >= 9) return "bg-red-100 text-red-700";
  if (score >= 7) return "bg-orange-100 text-orange-700";
  if (score >= 4) return "bg-yellow-100 text-yellow-700";
  return "bg-gray-100 text-gray-600";
}

function SummaryStrip({ vulnerabilities }: { vulnerabilities: VulnItem[] }) {
  const t = useTranslations("vulnerabilities");
  const counts = useMemo(() => {
    const c = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
    for (const v of vulnerabilities) {
      c.total++;
      const key = normSeverity(v.severity);
      if (key in c) c[key as keyof typeof c]++;
    }
    return c;
  }, [vulnerabilities]);

  return (
    <div className="panel p-3 flex flex-wrap items-center gap-x-5 gap-y-2" role="group" aria-label={t("summary-total")}>
      <div>
        <span className="text-xs text-[var(--color-ink-muted)]">{t("summary-total")} </span>
        <span className="text-lg font-bold text-[var(--color-ink)]">{counts.total}</span>
      </div>
      <div className="w-px h-6 bg-[var(--color-hairline)]" aria-hidden="true" />
      {[
        { label: t("summary-critical"), count: counts.critical, cls: "text-red-600" },
        { label: t("summary-high"), count: counts.high, cls: "text-orange-600" },
        { label: t("summary-medium"), count: counts.medium, cls: "text-yellow-600" },
        { label: t("summary-low"), count: counts.low, cls: "text-blue-600" },
      ].map(({ label, count, cls }) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--color-ink-muted)]">{label}</span>
          <span className={`text-base font-bold ${cls}`}>{count}</span>
        </div>
      ))}
    </div>
  );
}

export default function VulnerabilitiesPage() {
  const t = useTranslations("vulnerabilities");
  const tGlobal = useTranslations("shell");
  const [data, setData] = useState<PageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const load = () => {
    setLoading(true);
    fetch("/api/vulnerabilities")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load vulnerabilities");
        return r.json();
      })
      .then((body: { data: PageState }) => {
        setData(body.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.vulnerabilities.filter((v) => {
      if (agentFilter !== "all" && v.agentId !== agentFilter) return false;
      if (severityFilter !== "all") {
        if (normSeverity(v.severity) !== severityFilter.toLowerCase()) return false;
      }
      return true;
    });
  }, [data, agentFilter, severityFilter]);

  if (loading && !data) {
    return (
      <section className="page-section">
        <header>
          <h1>{tGlobal("vulnerabilities")}</h1>
        </header>
        <div className="panel p-6" role="status">
          <p className="text-sm text-[var(--color-ink-muted)] flex items-center gap-2">
            <RefreshCw className="animate-spin" size={16} /> {t("loading")}
          </p>
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="page-section">
        <header>
          <h1>{tGlobal("vulnerabilities")}</h1>
        </header>
        <p className="status-error p-4">{error}</p>
      </section>
    );
  }

  return (
    <section className="page-section space-y-6" aria-label={tGlobal("vulnerabilities")}>
      {/* Header + filters in one bar */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1>{tGlobal("vulnerabilities")}</h1>
          {data && data.vulnerabilities.length > 0 && (
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {t("showing-count", { count: filtered.length, total: data.vulnerabilities.length })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="agentFilter" className="sr-only">{t("filter-agent")}</label>
            <select
              id="agentFilter"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="text-sm border border-[var(--color-hairline)] bg-[var(--color-canvas)] rounded px-2 py-1.5 h-9"
            >
              <option value="all">{t("filter-agent-all")}</option>
              {data?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id})
                </option>
              ))}
            </select>
            <label htmlFor="severityFilter" className="sr-only">{t("filter-severity")}</label>
            <select
              id="severityFilter"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="text-sm border border-[var(--color-hairline)] bg-[var(--color-canvas)] rounded px-2 py-1.5 h-9"
            >
              <option value="all">{t("filter-severity-all")}</option>
              <option value="critical">{t("severity-critical")}</option>
              <option value="high">{t("severity-high")}</option>
              <option value="medium">{t("severity-medium")}</option>
              <option value="low">{t("severity-low")}</option>
            </select>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="outline-button p-2 h-9"
            aria-label={t("refresh")}
            title={t("refresh")}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
          </button>
        </div>
      </header>

      {data && <SummaryStrip vulnerabilities={data.vulnerabilities} />}

      {data?.stale && (
        <div className="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm flex items-center gap-2" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /> {t("stale-data")}
        </div>
      )}

      {data?.indexerError && (
        <div className="bg-red-50 text-red-800 p-3 rounded-md text-sm flex items-center gap-2" role="alert">
          <ShieldAlert size={16} aria-hidden="true" /> Indexer connection failed or timed out. Check connectivity and credentials.
        </div>
      )}

      {data && !data.indexerConfigured ? (
        <div className="panel p-6 text-center">
          <ShieldAlert className="mx-auto text-[var(--color-ink-muted)] mb-4" size={32} aria-hidden="true" />
          <h2 className="text-base font-semibold mb-2">{t("indexer-not-configured")}</h2>
          <p className="text-sm text-[var(--color-ink-muted)] mb-6 max-w-md mx-auto">{t("indexer-not-configured-desc")}</p>
          <Link href="/settings/cloud" className="primary-button inline-flex items-center gap-2 px-4 py-2 text-sm font-medium">
            <Settings size={16} /> {t("configure-indexer")}
          </Link>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-[var(--color-ink-muted)]">
              {t("no-vulnerabilities")}
            </p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="table">
                <thead>
                  <tr>
                    <th className="th">{t("col-severity")}</th>
                    <th className="th">{t("col-cve")}</th>
                    <th className="th">{t("col-title")}</th>
                    <th className="th">{t("col-published")}</th>
                    <th className="th">{t("col-agent")}</th>
                    <th className="th">{t("col-cvss")}</th>
                    <th className="th">{t("col-status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-hairline-cool)]">
                  {filtered.slice(0, 50).map((v) => {
                    const Icon = getSeverityIcon(v.severity);
                    const colorClass = getSeverityColorClass(v.severity);
                    const sevKey = normSeverity(v.severity);
                    return (
                      <tr
                        key={`${v.agentId}-${v.cve}`}
                        className="group hover:bg-[var(--color-canvas-soft)] transition-colors"
                      >
                        <td className="td py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}
                            data-testid={`severity-badge-${sevKey}`}
                            title={`${t(`severity-${sevKey}`)} severity`}
                          >
                            <Icon size={12} aria-hidden="true" />
                            {t(`severity-${sevKey}`)}
                          </span>
                        </td>
                        <td className="td whitespace-nowrap py-3">
                          <span className="text-sm font-mono font-medium text-[var(--color-ink)]">{v.cve}</span>
                        </td>
                        <td className="td py-3 max-w-xs min-w-0">
                          <p className="text-sm text-[var(--color-ink)] leading-snug line-clamp-2">
                            {v.title || v.condition || "-"}
                          </p>
                        </td>
                        <td className="td py-3 whitespace-nowrap">
                          <span className="text-xs text-[var(--color-ink-muted)]">
                            {v.published ? new Date(v.published).toLocaleDateString() : "-"}
                          </span>
                        </td>
                        <td className="td py-3">
                          <p className="text-sm font-medium text-[var(--color-ink)]">{v.agentName}</p>
                          <p className="text-xs text-[var(--color-ink-muted)]">{v.agentId}</p>
                        </td>
                        <td className="td py-3 whitespace-nowrap">
                          {v.cvss_score != null ? (
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cvssColorClass(v.cvss_score)}`}
                              title={`CVSS ${v.cvss_score.toFixed(1)}`}
                            >
                              {v.cvss_score.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-sm text-[var(--color-ink-muted)]">-</span>
                          )}
                        </td>
                        <td className="td py-3 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] text-xs text-[var(--color-ink-muted)]">
                            {v.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
              {filtered.length > 50 && (
                <p className="border-t border-[var(--color-hairline-cool)] px-4 py-2 text-xs text-[var(--color-ink-muted)]" role="status">
                  {t("showing-count", { count: 50, total: filtered.length })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
