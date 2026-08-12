"use client";

import { useEffect, useMemo, useState } from "react";
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
interface PageData {
  policies: PolicyAggregate[];
  agentsScanned: number;
  stale: boolean;
}

function scoreColor(score: number): string {
  if (score >= 80) return "var(--color-primary-deep)";
  if (score >= 50) return "#f59e0b";
  return "var(--color-danger)";
}

function scoreLabel(t: (k: string) => string, score: number): string {
  if (score >= 80) return t("status-pass");
  if (score >= 50) return t("status-warn");
  return t("status-fail");
}

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

  const summary = useMemo(() => {
    if (!data) return null;
    const policies = data.policies;
    const totalPass = policies.reduce((s, p) => s + p.pass, 0);
    const totalFail = policies.reduce((s, p) => s + p.fail, 0);
    const totalChecks = totalPass + totalFail;
    const overallScore = totalChecks > 0 ? Math.round((totalPass / totalChecks) * 100) : 0;
    return { totalPass, totalFail, totalChecks, overallScore, policyCount: policies.length };
  }, [data]);

  if (error && !data) {
    return (
      <section className="page-section">
        <h1>{shell("compliance")}</h1>
        <div className="panel p-4 mt-4 flex items-start gap-3 status-error" role="alert">
          <ShieldAlert size={18} className="shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="page-section">
        <h1>{shell("compliance")}</h1>
        <div className="panel p-6 mt-4 flex items-center gap-3 text-sm text-[var(--color-ink-muted)]" role="status" aria-live="polite">
          <RefreshCw size={16} className="animate-spin" />
          <span>{t("loading")}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section space-y-6" aria-label={shell("compliance")}>
      {/* Header row */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
      </header>

      {error && (
        <div className="panel p-3 flex items-center gap-2 text-sm status-error" role="alert">
          <ShieldAlert size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary strip */}
      {summary && (
        <div className="panel p-4" role="group" aria-label={t("summary-label")}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {/* Score circle */}
            <div className="flex items-center gap-3 shrink-0">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ background: scoreColor(summary.overallScore) }}
                aria-hidden="true"
              >
                {summary.overallScore}%
              </div>
              <div>
                <p className="text-xs text-[var(--color-ink-muted)] uppercase tracking-wider">{t("overall-score")}</p>
                <p className="text-sm font-semibold" style={{ color: scoreColor(summary.overallScore) }}>
                  {scoreLabel(t, summary.overallScore)}
                </p>
              </div>
            </div>

            <div className="h-8 w-px bg-[var(--color-hairline)] shrink-0" aria-hidden="true" />

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <div>
                <span className="text-xs text-[var(--color-ink-muted)]">{t("passed")} </span>
                <span className="text-lg font-bold text-[var(--color-primary-deep)]">{summary.totalPass}</span>
              </div>
              <div>
                <span className="text-xs text-[var(--color-ink-muted)]">{t("failed")} </span>
                <span className="text-lg font-bold" style={{ color: summary.totalFail > 0 ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
                  {summary.totalFail}
                </span>
              </div>
              <div>
                <span className="text-xs text-[var(--color-ink-muted)]">{t("total-checks")} </span>
                <span className="text-lg font-bold">{summary.totalChecks}</span>
              </div>
              <div>
                <span className="text-xs text-[var(--color-ink-muted)]">{t("policies")} </span>
                <span className="text-lg font-bold">{summary.policyCount}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {data.policies.length === 0 ? (
        <div className="panel p-12 flex flex-col items-center text-center">
          <ShieldCheck size={32} className="text-[var(--color-border)] mb-4" />
          <p className="font-medium">{t("no-data")}</p>
          <p className="text-sm text-[var(--color-ink-muted)] mt-1">{t("no-data-desc")}</p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Policy</th>
                  <th className="th text-center">Score</th>
                  <th className="th text-center">Status</th>
                  <th className="th text-center">Passed</th>
                  <th className="th text-center">Failed</th>
                  <th className="th text-center">Checks</th>
                  <th className="th text-center">Agents</th>
                  <th className="th">Frameworks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-hairline-cool)]">
                {data.policies.slice(0, 50).map((policy) => {
                  const sc = scoreColor(policy.score);
                  const sl = scoreLabel(t, policy.score);
                  return (
                    <tr key={policy.policyId} className="hover:bg-[var(--color-canvas-soft)] transition-colors">
                      <td className="td py-3">
                        <span className="block max-w-[200px] sm:max-w-xs truncate text-sm font-medium text-[var(--color-ink)]" title={policy.name}>
                          {policy.name}
                        </span>
                      </td>
                      <td className="td py-3 text-center">
                        <span
                          className="inline-block text-xs font-semibold px-2 py-0.5 rounded border"
                          style={{ color: sc, borderColor: sc, backgroundColor: `color-mix(in srgb, ${sc} 10%, transparent)` }}
                          title={`${t("score")}: ${policy.score}%`}
                        >
                          {policy.score}%
                        </span>
                      </td>
                      <td className="td py-3 text-center">
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
                          style={{ color: sc, backgroundColor: `color-mix(in srgb, ${sc} 10%, transparent)` }}
                          title={sl}
                        >
                          {sl}
                        </span>
                      </td>
                      <td className="td py-3 text-center">
                        <span className="text-sm font-semibold text-[var(--color-primary-deep)]">{policy.pass}</span>
                      </td>
                      <td className="td py-3 text-center">
                        <span className="text-sm font-semibold" style={{ color: policy.fail > 0 ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
                          {policy.fail}
                        </span>
                      </td>
                      <td className="td py-3 text-center text-sm text-[var(--color-ink-muted)]">{policy.totalChecks}</td>
                      <td className="td py-3 text-center text-sm text-[var(--color-ink)]">{policy.agentCount}</td>
                      <td className="td py-3">
                        {policy.references ? (
                          <div className="flex flex-wrap gap-1">
                            {policy.references.split(",").slice(0, 3).map((ref) => (
                              <span key={ref.trim()} className="inline-block max-w-[120px] truncate align-bottom text-[10px] bg-[var(--color-border)] px-1.5 py-0.5 rounded uppercase tracking-wide" title={ref.trim()}>
                                {ref.trim()}
                              </span>
                            ))}
                            {policy.references.split(",").length > 3 && (
                              <span className="text-[10px] text-[var(--color-ink-muted)] px-1 py-0.5">
                                +{policy.references.split(",").length - 3}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.policies.length > 50 && (
            <p className="border-t border-[var(--color-hairline-cool)] px-4 py-2 text-xs text-[var(--color-ink-muted)]" role="status">
              {t("showing-count", { count: 50, total: data.policies.length })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
