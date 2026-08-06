"use client";

import Link from "next/link";
import type { AlertRecord } from "../../server/alerts/types";

export function AlertTable({
  status, alerts, onAcknowledge, onResolve, canModify,
}: {
  status: "loading" | "success" | "error" | "stale";
  alerts: readonly AlertRecord[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  canModify: boolean;
}) {
  if (status === "loading") return <p role="status">loading</p>;
  if (status === "error") return <p role="alert">unavailable</p>;
  if (alerts.length === 0) return <p>empty</p>;
  return <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <caption className="sr-only">Security alerts</caption>
      <thead><tr><th align="left">Rule</th><th align="left">Agent</th><th align="left">Severity</th><th align="left">Status</th><th align="left">Actions</th></tr></thead>
      <tbody>{alerts.map((alert) => <tr key={alert.id}>
        <td><Link href={`/alerts/${alert.id}`}>{alert.ruleDescription}</Link><small style={{ display: "block" }}>{alert.ruleId ?? "-"}</small></td>
        <td>{alert.agentName ?? alert.agentId ?? "-"}</td>
        <td><span aria-label={`severity ${alert.level}`}>{alert.level}</span></td>
        <td>{alert.status}</td>
        <td>{canModify && alert.status === "open" && <button type="button" onClick={() => onAcknowledge(alert.id)}>Acknowledge</button>}{canModify && alert.status !== "resolved" && <button type="button" onClick={() => onResolve(alert.id)}>Resolve</button>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
