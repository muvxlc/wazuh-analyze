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
  stale: boolean;
  upstreamErrorCode?: string;
}

const severityMap: Record<string, { label: string; icon: typeof AlertTriangle; colorClass: string; weight: number }> = {
  Critical: { label: "critical", icon: ShieldAlert, colorClass: "text-red-500", weight: 4 },
  High: { label: "high", icon: ShieldAlert, colorClass: "text-orange-500", weight: 3 },
  Medium: { label: "medium", icon: AlertTriangle, colorClass: "text-yellow-500", weight: 2 },
  Low: { label: "low", icon: AlertCircle, colorClass: "text-blue-500", weight: 1 },
};

function getSeverityProps(sev: string) {
  const norm = sev.charAt(0).toUpperCase() + sev.slice(1).toLowerCase();
  return severityMap[norm] ?? { label: "info", icon: Info, colorClass: "text-gray-500", weight: 0 };
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
        const norm = v.severity.toLowerCase();
        if (norm !== severityFilter.toLowerCase()) return false;
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
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1>{tGlobal("vulnerabilities")}</h1>
        <button onClick={load} disabled={loading} className="outline-button px-3 py-1.5 text-xs flex items-center gap-2">
          <RefreshCw className={loading ? "animate-spin" : ""} size={14} />
          {t("refresh")}
        </button>
      </header>

      {data?.stale && (
        <div className="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {t("stale-data")}
        </div>
      )}

      {data && !data.indexerConfigured ? (
        <div className="panel p-6 text-center">
          <ShieldAlert className="mx-auto text-[var(--color-ink-muted)] mb-4" size={32} />
          <h2 className="text-base font-semibold mb-2">{t("indexer-not-configured")}</h2>
          <p className="text-sm text-[var(--color-ink-muted)] mb-6 max-w-md mx-auto">{t("indexer-not-configured-desc")}</p>
          <Link href="/settings/cloud" className="primary-button inline-flex items-center gap-2 px-4 py-2 text-sm font-medium">
            <Settings size={16} /> {t("configure-indexer")}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-4 bg-[var(--color-canvas-soft)] p-3 rounded-[6px] border border-[var(--color-border)]">
            <div className="flex-1">
              <label htmlFor="agentFilter" className="block text-xs font-medium text-[var(--color-ink-muted)] mb-1">{t("filter-agent")}</label>
              <select id="agentFilter" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="w-full text-sm border border-[var(--color-input-border)] bg-[var(--color-canvas)] rounded px-2 py-1.5">
                <option value="all">{t("filter-agent-all")}</option>
                {data?.agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label htmlFor="severityFilter" className="block text-xs font-medium text-[var(--color-ink-muted)] mb-1">{t("filter-severity")}</label>
              <select id="severityFilter" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="w-full text-sm border border-[var(--color-input-border)] bg-[var(--color-canvas)] rounded px-2 py-1.5">
                <option value="all">{t("filter-severity-all")}</option>
                <option value="critical">{t("severity-critical")}</option>
                <option value="high">{t("severity-high")}</option>
                <option value="medium">{t("severity-medium")}</option>
                <option value="low">{t("severity-low")}</option>
              </select>
            </div>
          </div>

          <div className="panel overflow-hidden">
            {filtered.length === 0 ? (
              <p className="p-8 text-center text-sm text-[var(--color-ink-muted)]">{t("no-vulnerabilities")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="th">{t("col-severity")}</th>
                      <th className="th">{t("col-cve")}</th>
                      <th className="th">{t("col-title")}</th>
                      <th className="th">{t("col-agent")}</th>
                      <th className="th">{t("col-cvss")}</th>
                      <th className="th">{t("col-status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {filtered.map((v) => {
                      const sev = getSeverityProps(v.severity);
                      const Icon = sev.icon;
                      return (
                        <tr key={`${v.agentId}-${v.cve}`} className="group hover:bg-[var(--color-canvas-soft)] transition-colors">
                          <td className="td w-0 py-3">
                            <div className="flex items-center gap-1.5">
                              <Icon size={14} className={sev.colorClass} />
                              <span className="text-xs font-medium uppercase tracking-wider">{t(`severity-${sev.label}`)}</span>
                            </div>
                          </td>
                          <td className="td whitespace-nowrap py-3">
                            <span className="text-sm font-medium">{v.cve}</span>
                          </td>
                          <td className="td py-3 max-w-sm truncate text-sm" title={v.title}>
                            {v.title || v.condition || "-"}
                          </td>
                          <td className="td py-3">
                            <div className="text-sm">{v.agentName}</div>
                            <div className="text-xs text-[var(--color-ink-muted)]">{v.agentId}</div>
                          </td>
                          <td className="td py-3 whitespace-nowrap text-sm">
                            {v.cvss_score ? (
                              <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${v.cvss_score >= 9.0 ? 'bg-red-100 text-red-800' : v.cvss_score >= 7.0 ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'}`}>
                                {v.cvss_score.toFixed(1)}
                              </span>
                            ) : "-"}
                          </td>
                          <td className="td py-3 whitespace-nowrap text-sm">
                            <span className="px-1.5 py-0.5 rounded bg-[var(--color-canvas-soft)] border border-[var(--color-border)] text-xs">
                              {v.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
