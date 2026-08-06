"use client";

import { useEffect, useState } from "react";

interface Summary { health: { status: string; stale: boolean }; agentStatus: Record<string, number>; alertSeverity: Record<string, number>; workflows: Record<string, number> }
export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => { void fetch("/api/dashboard/summary").then((response) => response.ok ? response.json() : Promise.reject()).then((body: { data: Summary }) => setSummary(body.data)).catch(() => setSummary(null)); }, []);
  if (!summary) return <section><h1>Dashboard</h1><p role="status">Loading dashboard</p></section>;
  return <section><h1>Dashboard</h1><p>Wazuh: <strong>{summary.health.status}</strong>{summary.health.stale && " (stale)"}</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16 }}><section><h2>Agents</h2>{Object.entries(summary.agentStatus).map(([key, value]) => <p key={key}>{key}: {value}</p>)}</section><section><h2>Alert severity</h2>{Object.entries(summary.alertSeverity).map(([key, value]) => <p key={key}>Level {key}: {value}</p>)}</section><section><h2>Workflow</h2>{Object.entries(summary.workflows).map(([key, value]) => <p key={key}>{key}: {value}</p>)}</section></div></section>;
}
