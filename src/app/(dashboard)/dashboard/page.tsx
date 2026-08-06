"use client";

import { useEffect, useState } from "react";
import { SEVERITY_COLORS, severityFromLevel, severityLabel } from "../../../server/alerts/severity-mapper";

interface Summary {
  health: { status: string; stale: boolean; upstreamErrorCode: string | null; connectionStatus: "connected" | "disconnected"; reason: string; };
  agentStatus: Record<string, number>;
  alertSeverity: Record<string, number>;
  workflows: Record<string, number>;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void fetch("/api/dashboard/summary")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { data: Summary }) => setSummary(body.data))
      .catch(() => setFailed(true));
  }, []);

  if (!summary) {
    return (
      <p className={failed ? "status-error" : "rounded-[var(--radius-panel)] border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-4"} role="status">
        {failed ? "Dashboard unavailable" : "Loading dashboard"}
      </p>
    );
  }

  const groups = [
    ["Agents", summary.agentStatus],
    ["Workflow", summary.workflows],
  ] as const;

  const severityBuckets = aggregateSeverity(summary.alertSeverity);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <p className={`wazuh-status wazuh-status-${summary.health.connectionStatus}`} aria-label={`Wazuh ${summary.health.connectionStatus}: ${summary.health.reason}`}>
          <span className="wazuh-status-dot" aria-hidden="true" />
          <span>Wazuh: <strong>{summary.health.connectionStatus}</strong></span>
        </p>
      </div>
      <div className="dashboard-grid">
        {severityBuckets.map(({ severity, count }) => (
          <section className="panel dashboard-panel" key={severity} aria-label={`${severityLabel(severity)} severity summary`}>
            <div className="mb-5 flex items-center justify-between gap-3 border-b border-[var(--color-hairline-cool)] pb-3">
              <h2>
                <span
                  className="severity-badge"
                  style={{ backgroundColor: SEVERITY_COLORS[severity], color: "var(--color-on-dark)" }}
                >
                  {severityLabel(severity)}
                </span>
              </h2>
              <span className="text-xs text-[var(--color-ink-muted)]">Open alerts</span>
            </div>
            <p className="dashboard-values">
              <strong style={{ fontSize: "28px" }}>{count}</strong>
            </p>
          </section>
        ))}
      </div>
      <div className="dashboard-grid">
        {groups.map(([title, values]) => (
          <section className="panel dashboard-panel" key={title}>
            <div className="mb-5 flex items-center justify-between gap-3 border-b border-[var(--color-hairline-cool)] pb-3">
              <h2>{title}</h2>
              <span className="text-xs text-[var(--color-ink-muted)]">Live data</span>
            </div>
            <div className="dashboard-values">
              {Object.entries(values).map(([key, value]) => (
                <p key={key}>
                  <span>{key}</span>
                  <strong>{value}</strong>
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function aggregateSeverity(alertSeverity: Record<string, number>): Array<{ severity: "critical" | "high" | "medium" | "low"; count: number }> {
  const buckets: Record<"critical" | "high" | "medium" | "low", number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const [key, value] of Object.entries(alertSeverity)) {
    const level = Number(key);
    if (Number.isFinite(level)) {
      buckets[severityFromLevel(level)] += value;
    }
  }
  return [
    { severity: "critical", count: buckets.critical },
    { severity: "high", count: buckets.high },
    { severity: "medium", count: buckets.medium },
    { severity: "low", count: buckets.low },
  ];
}
