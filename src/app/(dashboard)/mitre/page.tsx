"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, AlertCircle, Hash, TrendingUp } from "lucide-react";
import Link from "next/link";

interface MitreTechnique {
  techniqueId: string;
  techniqueName: string | null;
  tactic: string | null;
  count: number;
}

interface PageState {
  range: string;
  techniques: MitreTechnique[];
}

export default function MitrePage() {
  const t = useTranslations("mitre");
  const shell = useTranslations("shell");
  const [data, setData] = useState<PageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("30d");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/mitre?range=${encodeURIComponent(range)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Failed to load MITRE data")))
      .then((body: { data: PageState }) => { setData(body.data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = useMemo(() => {
    if (!data) return null;
    const techniques = data.techniques;
    const totalAlerts = techniques.reduce((sum, t) => sum + t.count, 0);
    const tactics = new Set(techniques.map((t) => t.tactic || "Unknown")).size;
    const topTactic = techniques.length > 0
      ? [...techniques].sort((a, b) => b.count - a.count)[0].tactic
      : null;
    return { totalAlerts, tactics, topTactic, techniqueCount: techniques.length };
  }, [data]);

  const tactics = useMemo(() => {
    if (!data) return [];
    const grouped = new Map<string, MitreTechnique[]>();
    data.techniques.forEach((tech) => {
      const tactic = tech.tactic || "Unknown";
      if (!grouped.has(tactic)) grouped.set(tactic, []);
      grouped.get(tactic)!.push(tech);
    });
    return Array.from(grouped.entries()).sort((a, b) =>
      b[1].reduce((sum, t) => sum + t.count, 0) -
      a[1].reduce((sum, t) => sum + t.count, 0)
    );
  }, [data]);

  const rows = tactics.flatMap(([tacticName, items]) => {
    const total = items.reduce((sum, item) => sum + item.count, 0);
    const sortedItems = [...items].sort((a, b) => b.count - a.count);
    return sortedItems.map((tech, index) => ({ tacticName, tech, index, total, rowSpan: sortedItems.length }));
  });
  const visibleRows = rows.slice(0, 50);

  if (error && !data) {
    return (
      <section className="page-section">
        <h1>{shell("mitre")}</h1>
        <div className="panel p-4 mt-4 flex items-start gap-3 status-error" role="alert">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="page-section">
        <h1>{shell("mitre")}</h1>
        <div className="panel p-6 mt-4 flex items-center gap-3 text-sm text-[var(--color-ink-muted)]" role="status" aria-live="polite">
          <RefreshCw size={16} className="animate-spin" />
          <span>{t("loading")}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section space-y-6" aria-label={shell("mitre")}>
      {/* Header: title + controls + summary inline */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1>{shell("mitre")}</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
            <label htmlFor="mitre-range" className="sr-only">{t("range-label")}</label>
            <select
              id="mitre-range"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="rounded w-full sm:w-auto sm:min-w-[8rem]"
              disabled={loading}
            >
              <option value="7d">{t("range-7d")}</option>
              <option value="30d">{t("range-30d")}</option>
              <option value="90d">{t("range-90d")}</option>
            </select>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="outline-button p-2 h-9"
              title={t("refresh")}
              aria-label={t("refresh")}
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {error && (
          <div className="panel p-3 flex items-center gap-2 text-sm status-error" role="alert">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Compact summary strip */}
        {summary && summary.totalAlerts > 0 && (
          <div
            className="panel p-3 flex flex-wrap items-center gap-x-6 gap-y-2"
            role="group"
            aria-label={t("summary-label")}
          >
            <div>
              <span className="text-xs text-[var(--color-ink-muted)]">{t("metric-total-alerts")} </span>
              <span className="text-lg font-bold text-[var(--color-ink)]">{summary.totalAlerts.toLocaleString()}</span>
            </div>
            <div className="w-px h-6 bg-[var(--color-hairline)]" aria-hidden="true" />
            <div>
              <span className="text-xs text-[var(--color-ink-muted)]">{t("metric-techniques")} </span>
              <span className="text-lg font-bold text-[var(--color-ink)]">{summary.techniqueCount}</span>
            </div>
            <div>
              <span className="text-xs text-[var(--color-ink-muted)]">{t("metric-tactics")} </span>
              <span className="text-lg font-bold text-[var(--color-ink)]">{summary.tactics}</span>
            </div>
            <div className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
              <TrendingUp size={13} aria-hidden="true" />
              <span>{t("metric-top-tactic")}:</span>
              <span className="font-semibold text-[var(--color-ink)] truncate max-w-[180px]" title={summary.topTactic ?? ""}>
                {summary.topTactic ?? "—"}
              </span>
            </div>
          </div>
        )}
      </header>

      {tactics.length === 0 ? (
        <div className="panel p-12 flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium">{t("no-data")}</p>
          <p className="text-sm text-[var(--color-ink-muted)] mt-1">{t("no-data-desc")}</p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th className="th sticky left-0 z-20 bg-[var(--color-canvas)]">Tactic</th>
                  <th className="th">Technique</th>
                  <th className="th text-right">Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-hairline-cool)]">
                {visibleRows.map(({ tacticName, tech, index, total, rowSpan }, rowIndex) => (
                  <tr key={`${tacticName}-${tech.techniqueId}`} className="group hover:bg-[var(--color-canvas-soft)] transition-colors">
                    {index === 0 && (
                      <td
                        className="td sticky left-0 z-10 bg-[var(--color-canvas)] align-middle py-3 font-medium text-[var(--color-ink)] whitespace-nowrap"
                        rowSpan={Math.min(rowSpan, visibleRows.length - rowIndex)}
                      >
                        <span className="text-xs text-[var(--color-ink-muted)] block">{tacticName}</span>
                        <span className="text-[10px] text-[var(--color-ink-faint)]">
                          {total} {t("total-count")}
                        </span>
                      </td>
                    )}
                    <td className="td py-3">
                      <Link
                        href={`/alerts?search=${encodeURIComponent(tech.techniqueId)}`}
                        className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-primary-deep)] hover:underline"
                        aria-label={`${tech.techniqueId} - ${tech.techniqueName ?? t("unknown-technique")}`}
                      >
                        <Hash size={13} className="shrink-0" />
                        <span className="text-sm truncate">{tech.techniqueId}</span>
                      </Link>
                      <p
                        className="mt-0.5 text-xs text-[var(--color-ink-muted)] line-clamp-1"
                        title={tech.techniqueName ?? ""}
                      >
                        {tech.techniqueName ?? t("unknown-technique")}
                      </p>
                    </td>
                    <td className="td py-3 text-right">
                      <span
                        className="inline-block min-w-[2.5rem] text-center text-sm font-semibold bg-[var(--color-canvas-soft)] border border-[var(--color-hairline)] px-2 py-0.5 rounded"
                        aria-label={`${tech.count} alerts`}
                      >
                        {tech.count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > visibleRows.length && (
            <p className="border-t border-[var(--color-hairline-cool)] px-4 py-2 text-xs text-[var(--color-ink-muted)]" role="status">
              {t("row-cap-notice", { count: visibleRows.length, total: rows.length })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
