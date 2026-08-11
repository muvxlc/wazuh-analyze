"use client";

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, LayoutGrid, AlertCircle, Info, Hash } from "lucide-react";
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

  const load = () => {
    setLoading(true);
    fetch(`/api/mitre?range=${encodeURIComponent(range)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Failed to load MITRE data")))
      .then((body: { data: PageState }) => { setData(body.data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [range]);

  const tactics = useMemo(() => {
    if (!data) return [];
    const grouped = new Map<string, MitreTechnique[]>();
    data.techniques.forEach((tech) => {
      const tactic = tech.tactic || "Unknown";
      if (!grouped.has(tactic)) grouped.set(tactic, []);
      grouped.get(tactic)!.push(tech);
    });
    return Array.from(grouped.entries()).sort((a, b) => b[1].reduce((sum, t) => sum + t.count, 0) - a[1].reduce((sum, t) => sum + t.count, 0));
  }, [data]);

  if (error && !data) return <section className="page-section"><h1>{shell("mitre")}</h1><p className="status-error p-4 mt-4">{error}</p></section>;
  if (!data) return <section className="page-section"><h1>{shell("mitre")}</h1><p className="panel p-4 mt-4 text-sm text-[var(--color-ink-muted)] flex items-center gap-2" role="status"><RefreshCw className="animate-spin" size={16} />{t("loading")}</p></section>;

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1>{shell("mitre")}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={range} onChange={(e) => setRange(e.target.value)} className="text-sm border border-[var(--color-input-border)] bg-[var(--color-canvas)] rounded px-2 py-1.5 h-9" disabled={loading}>
            <option value="7d">{t("range-7d")}</option>
            <option value="30d">{t("range-30d")}</option>
            <option value="90d">{t("range-90d")}</option>
          </select>
          <button type="button" onClick={load} disabled={loading} className="outline-button p-2 h-9" title={t("refresh")} aria-label={t("refresh")}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </header>

      {error && <p className="status-error p-3">{error}</p>}

      {tactics.length === 0 ? (
        <div className="panel p-12 flex flex-col items-center justify-center text-center">
          <LayoutGrid size={32} className="text-[var(--color-border)] mb-4" />
          <p className="text-sm font-medium">{t("no-data")}</p>
          <p className="text-sm text-[var(--color-ink-muted)] mt-1">{t("no-data-desc")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
          {tactics.map(([tacticName, items]) => {
            const total = items.reduce((sum, item) => sum + item.count, 0);
            return (
              <section key={tacticName} className="panel flex flex-col">
                <header className="flex items-center justify-between border-b border-[var(--color-border)] p-3 bg-[var(--color-canvas-soft)]">
                  <h2 className="text-sm font-bold truncate flex-1" title={tacticName}>{tacticName}</h2>
                  <span className="text-xs font-semibold bg-[var(--color-canvas)] border border-[var(--color-border)] px-1.5 py-0.5 rounded-full" title={t("total-count")}>{total}</span>
                </header>
                <ul className="divide-y divide-[var(--color-border)] text-sm">
                  {items.map((tech, i) => (
                    <li key={`${tech.techniqueId}-${i}`} className="flex flex-col p-3 hover:bg-[var(--color-canvas-soft)] transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <Link href={`/alerts?search=${encodeURIComponent(tech.techniqueId)}`} className="font-semibold text-[var(--color-primary-deep)] hover:underline flex items-center gap-1">
                          <Hash size={12} /> {tech.techniqueId}
                        </Link>
                        <span className="text-xs font-medium bg-[var(--color-border)] px-1.5 rounded-md leading-relaxed">{tech.count}</span>
                      </div>
                      <p className="text-[var(--color-ink-muted)] text-xs line-clamp-2" title={tech.techniqueName ?? ""}>{tech.techniqueName ?? t("unknown-technique")}</p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
