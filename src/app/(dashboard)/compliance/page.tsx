"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, ShieldCheck, ShieldAlert, Users } from "lucide-react";

interface PolicyAggregate {
  policyId: string;
  name: string;
  references: string | null;
  pass: number;
  fail: number;
  totalChecks: number;
  score: number;
  agentCount: number;
}
interface PageData { policies: PolicyAggregate[]; agentsScanned: number; stale: boolean; }

export default function CompliancePage() {
  const t = useTranslations("compliance");
  const shell = useTranslations("shell");
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch(`/api/compliance`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Failed to load compliance data")))
      .then((body: { data: PageData }) => { setData(body.data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (error && !data) return <section className="page-section"><h1>{shell("compliance")}</h1><p className="status-error p-4 mt-4">{error}</p></section>;
  if (!data) return <section className="page-section"><h1>{shell("compliance")}</h1><p className="panel p-4 mt-4 text-sm text-[var(--color-ink-muted)] flex items-center gap-2" role="status"><RefreshCw className="animate-spin" size={16} />{t("loading")}</p></section>;

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3">
            {shell("compliance")}
            {data.agentsScanned > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-semibold bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-0.5 rounded-full text-[var(--color-ink-muted)]">
                <Users size={12} /> {data.agentsScanned}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} disabled={loading} className="outline-button p-2 h-9" title={t("refresh")} aria-label={t("refresh")}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </header>

      {error && <p className="status-error p-3">{error}</p>}

      {data.policies.length === 0 ? (
        <div className="panel p-12 flex flex-col items-center text-center">
          <ShieldCheck size={32} className="text-[var(--color-border)] mb-4" />
          <p className="font-medium">{t("no-data")}</p>
          <p className="text-sm text-[var(--color-ink-muted)] mt-1">{t("no-data-desc")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {data.policies.map((policy) => (
            <section key={policy.policyId} className="panel overflow-hidden flex flex-col">
              <header className="flex items-center justify-between border-b border-[var(--color-border)] p-4 bg-[var(--color-canvas-soft)]">
                <h2 className="text-sm font-semibold truncate flex-1 pr-4" title={policy.name}>{policy.name}</h2>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold bg-[var(--color-canvas)] border border-[var(--color-border)] px-1.5 py-0.5 rounded" title="Average Score">
                    {policy.score}%
                  </span>
                  <span className="text-xs font-semibold bg-[var(--color-canvas)] border border-[var(--color-border)] px-1.5 py-0.5 rounded flex items-center gap-1" title="Agents Applied">
                    <Users size={10} /> {policy.agentCount}
                  </span>
                </div>
              </header>
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex-1">
                    <p className="text-xs text-[var(--color-ink-muted)] uppercase tracking-wider mb-1">Passed</p>
                    <p className="font-semibold text-[var(--color-success)]">{policy.pass}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-[var(--color-ink-muted)] uppercase tracking-wider mb-1">Failed</p>
                    <p className="font-semibold text-[var(--color-danger)] flex items-center gap-1">
                      {policy.fail > 0 && <ShieldAlert size={14} />} {policy.fail}
                    </p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-[var(--color-ink-muted)] uppercase tracking-wider mb-1">Total</p>
                    <p className="font-semibold">{policy.totalChecks}</p>
                  </div>
                </div>

                {policy.references && (
                  <div className="pt-3 border-t border-[var(--color-border)]">
                    <p className="text-xs font-medium text-[var(--color-ink-muted)] mb-1">Frameworks</p>
                    <div className="flex flex-wrap gap-1">
                      {policy.references.split(",").slice(0, 5).map((ref) => (
                        <span key={ref.trim()} className="text-[10px] bg-[var(--color-border)] px-1.5 py-0.5 rounded uppercase tracking-wide">
                          {ref.trim()}
                        </span>
                      ))}
                      {policy.references.split(",").length > 5 && (
                        <span className="text-[10px] text-[var(--color-ink-muted)] px-1 py-0.5">+{policy.references.split(",").length - 5} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
