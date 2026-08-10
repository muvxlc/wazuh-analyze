"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, ShieldCheck, FileCheck2 } from "lucide-react";

interface Framework {
  framework: string;
  total: number;
  controls: Array<{ control: string; count: number }>;
}
interface PageData { range: string; frameworks: Framework[]; }

const frameworkLabels: Record<string, string> = {
  pci_dss: "PCI DSS", gdpr: "GDPR", hipaa: "HIPAA", nist_800_53: "NIST 800-53", nist80053: "NIST 800-53", tsc: "TSC",
};

export default function CompliancePage() {
  const t = useTranslations("compliance");
  const shell = useTranslations("shell");
  const [data, setData] = useState<PageData | null>(null);
  const [range, setRange] = useState("30d");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch(`/api/compliance?range=${range}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Failed to load compliance data")))
      .then((body: { data: PageData }) => { setData(body.data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [range]);

  if (error && !data) return <section className="page-section"><h1>{shell("compliance")}</h1><p className="status-error p-4 mt-4">{error}</p></section>;
  if (!data) return <section className="page-section"><h1>{shell("compliance")}</h1><p className="panel p-4 mt-4 text-sm text-[var(--color-ink-muted)] flex items-center gap-2" role="status"><RefreshCw className="animate-spin" size={16} />{t("loading")}</p></section>;

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1>{shell("compliance")}</h1><p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p></div>
        <div className="flex items-center gap-2">
          <select value={range} onChange={(e) => setRange(e.target.value)} className="text-sm border border-[var(--color-input-border)] bg-[var(--color-canvas)] rounded px-2 py-1.5 h-9" disabled={loading}><option value="7d">{t("range-7d")}</option><option value="30d">{t("range-30d")}</option><option value="90d">{t("range-90d")}</option></select>
          <button type="button" onClick={load} disabled={loading} className="outline-button p-2 h-9" title={t("refresh")} aria-label={t("refresh")}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </header>
      {error && <p className="status-error p-3">{error}</p>}
      {data.frameworks.length === 0 ? (
        <div className="panel p-12 flex flex-col items-center text-center"><ShieldCheck size={32} className="text-[var(--color-border)] mb-4" /><p className="font-medium">{t("no-data")}</p><p className="text-sm text-[var(--color-ink-muted)] mt-1">{t("no-data-desc")}</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {data.frameworks.map((framework) => (
            <section key={framework.framework} className="panel overflow-hidden">
              <header className="flex items-center justify-between border-b border-[var(--color-border)] p-4 bg-[var(--color-canvas-soft)]"><h2 className="text-base font-semibold">{frameworkLabels[framework.framework] ?? framework.framework.toUpperCase()}</h2><span className="text-xs font-semibold bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-1 rounded-full">{framework.total}</span></header>
              <ul className="divide-y divide-[var(--color-border)]">{framework.controls.map((control) => <li key={control.control} className="flex items-center justify-between gap-3 p-3 text-sm"><span className="flex items-center gap-2 min-w-0"><FileCheck2 size={15} className="text-[var(--color-primary-deep)] shrink-0" /><span className="truncate" title={control.control}>{control.control}</span></span><span className="text-xs text-[var(--color-ink-muted)] shrink-0">{control.count}</span></li>)}</ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
