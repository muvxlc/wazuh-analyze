"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Search, ShieldAlert, Activity, Tag, Clock, Database } from "lucide-react";
import Link from "next/link";

interface Indicator {
  indicator: string;
  type: string;
  abuseScore: number | null;
  abuseCategory: string | null;
  pulseCount: number | null;
  sources: string[];
  fetchedAt: string;
  ttlDays: number;
  expired: boolean;
}

interface PageData {
  query: string;
  type: string;
  limit: number;
  indicators: Indicator[];
}

export default function ThreatIntelPage() {
  const t = useTranslations("ti");
  const shell = useTranslations("shell");
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeType, setActiveType] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [syncPhase, setSyncPhase] = useState("");

  const sync = () => {
    if (syncing || syncJobId) return;
    setSyncing(true);
    fetch("/api/threat-intel/sync", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Sync failed. Check settings."))))
      .then((body: { data?: { jobId?: string } }) => {
        setSyncJobId(body.data?.jobId ?? null);
        setSyncPhase("queued");
        setSyncing(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSyncing(false);
      });
  };

  useEffect(() => {
    if (!syncJobId) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/api/threat-intel/sync/${syncJobId}`);
        if (!r.ok) throw new Error("status check failed");
        const body = (await r.json()) as { data?: { phase?: string; status?: string } };
        if (!mounted) return;
        setSyncPhase(body.data?.phase ?? "");
        const status = body.data?.status;
        if (status === "done" || status === "error") {
          setSyncJobId(null);
          setSyncPhase("");
          if (status === "error") setError("Sync failed. See queue logs.");
          else load();
          return;
        }
      } catch {
        // transient; keep polling
      }
      timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncJobId]);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeQuery) params.set("q", activeQuery);
    if (activeType !== "all") params.set("type", activeType);

    fetch(`/api/threat-intel?${params.toString()}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Failed to load Threat Intel data")))
      .then((body: { data: PageData }) => { setData(body.data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [activeQuery, activeType]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveQuery(query);
    setActiveType(type);
  };

  if (error && !data) return <section className="page-section"><h1>{shell("threatIntel")}</h1><p className="status-error p-4 mt-4">{error}</p></section>;
  if (!data && loading) return <section className="page-section"><h1>{shell("threatIntel")}</h1><p className="panel p-4 mt-4 text-sm text-[var(--color-ink-muted)] flex items-center gap-2" role="status"><RefreshCw className="animate-spin" size={16} />{t("loading")}</p></section>;

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1>{shell("threatIntel")}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={sync} disabled={syncing || !!syncJobId} className="outline-button px-3 py-1.5 text-xs flex items-center gap-2">
            <Database size={14} className={syncing || syncJobId ? "animate-pulse text-[var(--color-primary)]" : ""} />
            {syncing ? "Starting..." : syncJobId ? (syncPhase || "Syncing...") : "Sync Database"}
          </button>
        </div>
      </header>

      <div className="panel p-3">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]" size={16} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search-placeholder")}
              className="w-full text-sm border border-[var(--color-input-border)] bg-[var(--color-canvas)] rounded pl-9 pr-3 py-2"
            />
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="text-sm border border-[var(--color-input-border)] bg-[var(--color-canvas)] rounded px-2 py-2 sm:w-32"
          >
            <option value="all">{t("type-all")}</option>
            <option value="ip">{t("type-ip")}</option>
            <option value="domain">{t("type-domain")}</option>
            <option value="hash">{t("type-hash")}</option>
          </select>
          <button type="submit" disabled={loading} className="primary-button px-4 py-2 text-sm flex items-center justify-center gap-2 min-w-[100px]">
            {loading ? <RefreshCw size={16} className="animate-spin" /> : t("search")}
          </button>
        </form>
      </div>

      {error && <p className="status-error p-3">{error}</p>}

      <div className="panel overflow-hidden">
        {!data || data.indicators.length === 0 ? (
          <div className="p-12 flex flex-col items-center text-center">
            <ShieldAlert size={32} className="text-[var(--color-border)] mb-4" />
            <p className="font-medium">{t("no-data")}</p>
            <p className="text-sm text-[var(--color-ink-muted)] mt-1">{t("no-data-desc")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="th w-1/4">{t("col-indicator")}</th>
                  <th className="th w-32">{t("col-score")}</th>
                  <th className="th w-1/4">{t("col-category")}</th>
                  <th className="th">{t("col-sources")}</th>
                  <th className="th w-40">{t("col-fetched")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.indicators.map((ioc) => (
                  <tr key={`${ioc.indicator}-${ioc.type}`} className="group hover:bg-[var(--color-canvas-soft)]">
                    <td className="td font-medium">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-primary-deep)]">{ioc.indicator}</span>
                        <span className="text-[10px] uppercase font-bold tracking-wider bg-[var(--color-canvas-soft)] border border-[var(--color-border)] px-1.5 py-0.5 rounded text-[var(--color-ink-muted)]">
                          {ioc.type}
                        </span>
                      </div>
                    </td>
                    <td className="td">
                      <div className="flex flex-col gap-1">
                        {ioc.abuseScore !== null && (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full w-max ${
                            ioc.abuseScore >= 80 ? "bg-red-100 text-red-800 border border-red-200" :
                            ioc.abuseScore >= 40 ? "bg-orange-100 text-orange-800 border border-orange-200" :
                            "bg-green-100 text-green-800 border border-green-200"
                          }`}>
                            <Activity size={12} /> {ioc.abuseScore}
                          </span>
                        )}
                        {ioc.pulseCount !== null && (
                          <span className="text-[10px] text-[var(--color-ink-muted)]">
                            {ioc.pulseCount} {t("pulses")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="td text-sm">
                      {ioc.abuseCategory ? (
                        <div className="flex items-center gap-1.5 text-[var(--color-ink-muted)]">
                          <Tag size={14} className="shrink-0" />
                          <span className="line-clamp-2" title={ioc.abuseCategory}>{ioc.abuseCategory}</span>
                        </div>
                      ) : "-"}
                    </td>
                    <td className="td text-xs text-[var(--color-ink-muted)]">
                      <div className="flex flex-wrap gap-1">
                        {ioc.sources.map(src => (
                          <span key={src} className="bg-[var(--color-canvas-soft)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
                            {src}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="td text-xs text-[var(--color-ink-muted)] whitespace-nowrap">
                      <div className="flex items-center gap-1.5" title={new Date(ioc.fetchedAt).toLocaleString()}>
                        <Clock size={12} className={ioc.expired ? "text-yellow-600" : ""} />
                        <span className={ioc.expired ? "text-yellow-600 font-medium" : ""}>
                          {new Date(ioc.fetchedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
