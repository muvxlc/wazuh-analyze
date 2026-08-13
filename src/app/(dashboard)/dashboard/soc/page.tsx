"use client";

import { useEffect, useState, useMemo } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { SEVERITY_COLORS, severityFromLevel, severityLabel } from "../../../../server/alerts/severity-mapper";

interface SocMetrics {
  range: "24h" | "7d" | "30d";
  mttdSeconds: number | null;
  mttrSeconds: number | null;
  falsePositiveRate: number | null;
  alertsOverTime: Array<{ bucket: string; level: number; count: number }>;
  topAgents: Array<{ agentId: string | null; agentName: string | null; count: number }>;
  topRules: Array<{ ruleId: string | null; ruleDescription: string | null; count: number }>;
  mitreHeatmap: Array<{ tactic: string; count: number }>;
  threatIntelDistribution: Array<{ category: string; count: number }>;
  incidentBacklog: number;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function truncateTick(value: string): string {
  return value.length > 18 ? `${value.slice(0, 17)}…` : value;
}

export default function SocDashboardPage() {
  const [metrics, setMetrics] = useState<SocMetrics | null>(null);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false);
    fetch(`/api/dashboard/soc?range=${range}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { data: SocMetrics }) => setMetrics(body.data))
      .catch(() => setFailed(true));
  }, [range]);

  const alertsTimeline = useMemo(() => {
    if (!metrics) return [];
    const buckets = new Map<string, { time: string; critical: number; high: number; medium: number; low: number }>();
    for (const row of metrics.alertsOverTime) {
      const d = new Date(row.bucket);
      // Preserve chronological order: keep a sortable ISO key but show a
      // human label. 24h → clock time, 7d/30d → short date.
      const key = d.toISOString();
      if (!buckets.has(key)) {
        buckets.set(key, {
          time: metrics.range === "24h"
            ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString([], { month: "short", day: "numeric" }),
          critical: 0, high: 0, medium: 0, low: 0,
        });
      }
      const sev = severityFromLevel(row.level);
      buckets.get(key)![sev] += row.count;
    }
    return Array.from(buckets.values());
  }, [metrics]);

  if (!metrics && failed) {
    return (
      <div className="space-y-6">
        <p className="status-error p-4" role="alert">Failed to load SOC metrics.</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="space-y-6">
        <p className="panel p-4" role="status">Loading SOC metrics…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end w-full sm:w-auto">
        <select
          className="w-full sm:w-auto"
          value={range}
          onChange={(e) => setRange(e.target.value as "24h" | "7d" | "30d")}
          aria-label="Time range"
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="panel p-5">
          <p className="text-sm font-medium text-[var(--color-ink-muted)] mb-1">MTTD</p>
          <p className="text-3xl font-semibold">{formatDuration(metrics.mttdSeconds)}</p>
          <p className="text-xs text-[var(--color-ink-muted-2)] mt-1">Mean time to detect</p>
        </div>
        <div className="panel p-5">
          <p className="text-sm font-medium text-[var(--color-ink-muted)] mb-1">MTTR</p>
          <p className="text-3xl font-semibold">{formatDuration(metrics.mttrSeconds)}</p>
          <p className="text-xs text-[var(--color-ink-muted-2)] mt-1">Mean time to resolve</p>
        </div>
        <div className="panel p-5">
          <p className="text-sm font-medium text-[var(--color-ink-muted)] mb-1">AI False Positive Rate</p>
          <p className="text-3xl font-semibold">
            {metrics.falsePositiveRate !== null ? `${(metrics.falsePositiveRate * 100).toFixed(1)}%` : "—"}
          </p>
          <p className="text-xs text-[var(--color-ink-muted-2)] mt-1">vs human overrides</p>
        </div>
        <div className="panel p-5">
          <p className="text-sm font-medium text-[var(--color-ink-muted)] mb-1">Incident Backlog</p>
          <p className="text-3xl font-semibold">{metrics.incidentBacklog}</p>
          <p className="text-xs text-[var(--color-ink-muted-2)] mt-1">Open investigations</p>
        </div>
      </div>

      <div className="panel p-6">
        <h2 className="text-base font-semibold mb-6">Alerts over time</h2>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={alertsTimeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-hairline)" />
              <XAxis dataKey="time" interval="preserveStartEnd" tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: "8px", border: "1px solid var(--color-hairline)", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}
                itemStyle={{ fontSize: "14px" }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "16px" }} />
              <Bar dataKey="critical" name={severityLabel("critical")} stackId="a" fill={SEVERITY_COLORS.critical} maxBarSize={24} radius={[4, 4, 0, 0]} />
              <Bar dataKey="high" name={severityLabel("high")} stackId="a" fill={SEVERITY_COLORS.high} maxBarSize={24} />
              <Bar dataKey="medium" name={severityLabel("medium")} stackId="a" fill={SEVERITY_COLORS.medium} maxBarSize={24} />
              <Bar dataKey="low" name={severityLabel("low")} stackId="a" fill={SEVERITY_COLORS.low} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-6">
          <h2 className="mb-4 text-base font-semibold">Top Agents</h2>
          {metrics.topAgents.length > 0 ? (
            <ol className="space-y-3">
              {metrics.topAgents.map((agent, index) => (
                <li key={`${agent.agentId ?? agent.agentName ?? "unknown"}-${index}`} className="flex min-w-0 items-center justify-between gap-4 text-sm">
                  <span className="truncate">{agent.agentName ?? agent.agentId ?? "Unknown agent"}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{agent.count}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-[var(--color-ink-muted)]">No agents found.</p>
          )}
        </div>

        <div className="panel p-6">
          <h2 className="mb-4 text-base font-semibold">Top Rules</h2>
          {metrics.topRules.length > 0 ? (
            <ol className="space-y-3">
              {metrics.topRules.map((rule, index) => (
                <li key={`${rule.ruleId ?? rule.ruleDescription ?? "unknown"}-${index}`} className="flex min-w-0 items-center justify-between gap-4 text-sm">
                  <span className="truncate">{rule.ruleDescription ?? rule.ruleId ?? "Unknown rule"}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{rule.count}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-[var(--color-ink-muted)]">No rules found.</p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-6">
          <h2 className="text-base font-semibold mb-6">MITRE ATT&CK Tactics</h2>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.mitreHeatmap} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-hairline)" />
                <XAxis type="number" hide />
                <YAxis dataKey="tactic" type="category" width={120} tickFormatter={truncateTick} tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "var(--color-canvas-soft)" }} contentStyle={{ borderRadius: "8px" }} />
                <Bar dataKey="count" fill="var(--color-primary-deep)" maxBarSize={16} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: 'var(--color-ink-muted)', fontSize: 12 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {metrics.mitreHeatmap.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] text-center mt-[-130px]">No MITRE tactics found.</p>}
        </div>

        <div className="panel p-6">
          <h2 className="text-base font-semibold mb-6">Threat Intel Distribution</h2>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.threatIntelDistribution} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-hairline)" />
                <XAxis type="number" hide />
                <YAxis dataKey="category" type="category" width={120} tickFormatter={truncateTick} tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "var(--color-canvas-soft)" }} contentStyle={{ borderRadius: "8px" }} />
                <Bar dataKey="count" fill="#64748B" maxBarSize={16} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: 'var(--color-ink-muted)', fontSize: 12 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {metrics.threatIntelDistribution.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] text-center mt-[-130px]">No Threat Intel hits found.</p>}
        </div>
      </div>
    </div>
  );
}
