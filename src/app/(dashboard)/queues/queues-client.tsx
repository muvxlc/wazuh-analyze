"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

interface QueueDetail {
  name: string;
  deferredCount: number;
  queuedCount: number;
  readyCount: number;
  activeCount: number;
  failedCount: number;
  totalCount: number;
}

interface RecentJob {
  id: string;
  queue: string;
  state: string;
  retryCount: number;
  entityId: string | null;
  createdAt: string | Date;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
}

interface RunningRow {
  queue_name: string;
  entity_id: string;
  phase: string;
  status: string;
  started_at: string | Date;
  updated_at: string | Date;
}

interface SeriesPoint { hour: string | Date; queue: string; total: number; }

interface QueuesData {
  queues: Record<string, QueueDetail>;
  metrics: {
    pendingAlerts: number;
    perQueue: Record<string, { completed: number; failed: number; running: number; pending: number }>;
    totals: { completed: number; failed: number; running: number; processed: number; successRate: number };
  };
  recentJobs: RecentJob[];
  series: SeriesPoint[];
  running: RunningRow[];
}

interface Props { readonly canManage?: boolean; }

function fmtDuration(startISO: string | Date | null, endISO: string | Date | null): string {
  if (!startISO) return "-";
  const start = new Date(startISO).getTime();
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function fmtTime(v: string | Date): string {
  try { return new Date(v).toLocaleTimeString(); } catch { return "-"; }
}

export function QueuesClient({ canManage = false }: Props) {
  const t = useTranslations("queues");
  const [data, setData] = useState<QueuesData | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);
  const [actionJob, setActionJob] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = async () => {
    try {
      const res = await fetch("/api/queues");
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: QueuesData };
      setData(body.data);
      setLastUpdated(new Date());
      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll();
    intervalRef.current = setInterval(() => { void poll(); }, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const handleBackfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillMsg(null);
    try {
      const res = await fetch("/api/queues/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: { enqueued: number } };
      setBackfillMsg(t("backfillSuccess", { count: body.data.enqueued }));
      void poll();
    } catch {
      setBackfillMsg(t("error"));
    } finally {
      setBackfilling(false);
    }
  };

  const handleJobAction = async (jobId: string, action: "retry" | "cancel") => {
    if (actionJob) return;
    setActionJob(jobId);
    try {
      const res = await fetch(`/api/queues/jobs/${jobId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error();
      void poll();
    } catch {
      alert(t("error"));
    } finally {
      setActionJob(null);
    }
  };

  const chartData = useMemo(() => {
    if (!data) return [];
    const buckets = new Map<string, Record<string, number>>();
    for (const point of data.series) {
      const key = new Date(point.hour).getTime();
      const entry = buckets.get(String(key)) ?? { time: key };
      entry[point.queue] = (entry[point.queue] ?? 0) + point.total;
      buckets.set(String(key), entry);
    }
    return Array.from(buckets.values()).sort((a, b) => Number(a.time) - Number(b.time));
  }, [data]);

  const queues = data?.queues ?? {};
  const metrics = data?.metrics;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]">{t("title")}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {canManage && (
            <button
              type="button"
              onClick={() => void handleBackfill()}
              disabled={backfilling}
              className="rounded-[6px] bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-on-primary)] hover:opacity-90 disabled:opacity-50"
            >
              {backfilling ? "…" : t("backfill")}
            </button>
          )}
          {lastUpdated && (
            <p className="text-xs text-[var(--color-ink-muted)]" aria-live="polite">
              {t("lastUpdated")}: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
      </header>

      {backfillMsg && (
        <p className="text-xs text-[var(--color-ink-muted)]" role="status">{backfillMsg}</p>
      )}

      {status === "loading" && <p className="text-sm text-[var(--color-ink-muted)]" role="status">{t("loading")}</p>}
      {status === "error" && <p className="text-sm text-[var(--color-danger-ink)]" role="alert">{t("error")}</p>}
      {status === "success" && Object.keys(queues).length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]" role="status">{t("empty")}</p>
      )}

      {status === "success" && data && (
        <>
          {metrics && (
            <section aria-label={t("metrics")}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">{t("metrics")}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <MetricCard label={t("pendingAlerts")} value={metrics.pendingAlerts} tone="warn" />
                <MetricCard label={t("analyzedToday")} value={metrics.totals.completed} />
                <MetricCard label={t("runningNow")} value={metrics.totals.running} tone="active" />
                <MetricCard label={t("failedToday")} value={metrics.totals.failed} tone="danger" />
                <MetricCard label={t("successRate")} value={`${metrics.totals.successRate}%`} />
              </div>
            </section>
          )}

          {data.running.length > 0 && (
            <section className="rounded-[8px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">{t("runningNow")}</h2>
              <ul className="divide-y divide-[var(--color-hairline)] text-sm">
                {data.running.map((r, i) => (
                  <li key={`${r.queue_name}-${r.entity_id}-${i}`} className="flex flex-col gap-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs text-[var(--color-primary)]">{r.queue_name}</span>
                      <span className="font-mono text-xs text-[var(--color-ink-muted)] truncate max-w-[280px]" title={r.entity_id}>{r.entity_id}</span>
                      <span className="text-xs font-semibold uppercase text-[var(--color-ink)]">{r.phase}</span>
                      <span className="text-xs text-[var(--color-ink-muted)]">{fmtDuration(r.updated_at, null)}</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-hairline)]">
                      <span className="block h-full w-1/3 animate-pulse rounded-full bg-[var(--color-primary)]" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {chartData.length > 0 && (
            <section className="rounded-[8px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">{t("graphTitle")}</h2>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad-analyze" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(v) => fmtTime(v)}
                      tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(v) => fmtTime(v as string)}
                      contentStyle={{ background: "var(--color-canvas)", border: "1px solid var(--color-hairline)", fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="analyze-alert" name="analyze-alert" stroke="var(--color-primary)" fill="url(#grad-analyze)" />
                    <Area type="monotone" dataKey="dispatch-notification" name="dispatch-notification" stroke="#8884d8" fillOpacity={0.1} fill="#8884d8" />
                    <Area type="monotone" dataKey="execute-action" name="execute-action" stroke="#82ca9d" fillOpacity={0.1} fill="#82ca9d" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">{t("queue")}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(queues).map(([name, q]) => (
                <section
                  key={name}
                  className="rounded-[8px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5"
                  aria-label={`Queue: ${name}`}
                >
                  <h3 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">{name}</h3>
                  <dl className="space-y-2 text-sm">
                    <Stat label={t("queued")} value={q.queuedCount} />
                    <Stat label={t("ready")} value={q.readyCount} />
                    <Stat label={t("active")} value={q.activeCount} />
                    <Stat label={t("failed")} value={q.failedCount} danger={q.failedCount > 0} />
                    <Stat label={t("deferred")} value={q.deferredCount} />
                    <Stat label={t("total")} value={q.totalCount} />
                  </dl>
                </section>
              ))}
            </div>
          </section>

          <section className="rounded-[8px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">{t("latestJobs")}</h2>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-[var(--color-ink-muted)]">
                    <tr>
                      <th className="py-2 pr-3">Queue</th>
                      <th className="py-2 pr-3">{t("entity")}</th>
                      <th className="py-2 pr-3">{t("status")}</th>
                      <th className="py-2 pr-3">{t("duration")}</th>
                      <th className="py-2 pr-3">{t("retries")}</th>
                      <th className="py-2 pr-3">Created</th>
                      {canManage && <th className="py-2">{t("actions")}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-hairline)]">
                    {data.recentJobs.length === 0 ? (
                      <tr>
                        <td colSpan={canManage ? 7 : 6} className="py-4 text-center text-sm text-[var(--color-ink-muted)]">
                          {t("empty")}
                        </td>
                      </tr>
                    ) : (
                      data.recentJobs.map((job) => (
                        <tr key={job.id} className="align-top">
                          <td className="py-2 pr-3 font-mono text-xs">{job.queue}</td>
                          <td className="py-2 pr-3 font-mono text-xs text-[var(--color-ink-muted)] truncate max-w-[200px]" title={job.entityId ?? ""}>
                            {job.entityId ?? "-"}
                          </td>
                          <td className="py-2 pr-3">
                            <StateBadge state={job.state} />
                          </td>
                          <td className="py-2 pr-3 text-xs">{fmtDuration(job.startedAt, job.completedAt)}</td>
                          <td className="py-2 pr-3 text-xs">{job.retryCount}</td>
                          <td className="py-2 pr-3 text-xs text-[var(--color-ink-muted)]">{fmtTime(job.createdAt)}</td>
                          {canManage && (
                            <td className="py-2">
                              <div className="flex gap-2">
                                {["failed", "cancelled", "expired"].includes(job.state) && (
                                  <button
                                    type="button"
                                    onClick={() => void handleJobAction(job.id, "retry")}
                                    disabled={actionJob === job.id}
                                    className="text-xs font-semibold text-[var(--color-primary)] hover:underline disabled:opacity-50"
                                  >
                                    {actionJob === job.id ? "…" : t("retry")}
                                  </button>
                                )}
                                {["created", "retry", "active"].includes(job.state) && (
                                  <button
                                    type="button"
                                    onClick={() => void handleJobAction(job.id, "cancel")}
                                    disabled={actionJob === job.id}
                                    className="text-xs font-semibold text-[var(--color-danger-ink)] hover:underline disabled:opacity-50"
                                  >
                                    {actionJob === job.id ? "…" : t("cancel")}
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "danger" | "active" }) {
  const color = tone === "danger" ? "var(--color-danger-ink)" : tone === "warn" ? "#b7791f" : tone === "active" ? "var(--color-primary)" : "var(--color-ink)";
  return (
    <div className="rounded-[8px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-4">
      <p className="text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold font-mono" style={{ color }}>{value}</p>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className={`font-mono font-medium ${danger ? "text-[var(--color-danger-ink)]" : ""}`}>{value}</dd>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const tone =
    state === "completed" ? "var(--color-primary)" :
    state === "active" ? "#2563eb" :
    state === "failed" || state === "expired" ? "var(--color-danger-ink)" :
    "var(--color-ink-muted)";
  return (
    <span className="rounded-[4px] px-2 py-0.5 text-xs font-semibold uppercase" style={{ color: tone }}>
      {state}
    </span>
  );
}
