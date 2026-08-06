import Link from "next/link";
import type { AlertRecord } from "../../server/alerts/types";
import { SEVERITY_COLORS, severityFromLevel, severityLabel } from "../../server/alerts/severity-mapper";

export function AlertTable({
  status,
  alerts,
  onAcknowledge,
  onResolve,
  onReopen,
  canModify,
  onOpenDetail,
}: {
  status: "loading" | "success" | "error" | "stale";
  alerts: readonly AlertRecord[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onReopen?: (id: string) => void;
  canModify: boolean;
  onOpenDetail?: (alert: AlertRecord) => void;
}) {
  if (status === "loading") return <p role="status">loading</p>;
  if (status === "error") return <p role="alert">unavailable</p>;
  if (alerts.length === 0) return <p>empty</p>;

  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Security alerts</caption>
        <thead>
          <tr>
            <th>Rule</th>
            <th>Agent</th>
            <th>Severity</th>
            <th>Groups</th>
            <th>Tags</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => {
            const severity = severityFromLevel(alert.level);
            const severityColor = SEVERITY_COLORS[severity];
            return (
              <tr key={alert.id}>
                <td>
                  {onOpenDetail ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onOpenDetail(alert)}
                      aria-label={`View details for ${alert.ruleDescription}`}
                    >
                      {alert.ruleDescription}
                    </button>
                  ) : (
                    <Link href={`/alerts/${alert.id}`}>{alert.ruleDescription}</Link>
                  )}
                  <small className="table-meta">{alert.ruleId ?? "-"}</small>
                </td>
                <td>{alert.agentName ?? alert.agentId ?? "-"}</td>
                <td>
                  <span
                    className="severity-badge"
                    aria-label={`severity ${severityLabel(severity)}, level ${alert.level}`}
                    style={{ backgroundColor: severityColor, color: "var(--color-on-dark)" }}
                  >
                    {severityLabel(severity)}
                  </span>
                </td>
                <td>
                  <ul className="badge-list" aria-label="Agent groups">
                    {alert.groups.length === 0 ? (
                      <li className="muted">-</li>
                    ) : (
                      alert.groups.map((group) => (
                        <li key={group} className="group-badge">{group}</li>
                      ))
                    )}
                  </ul>
                </td>
                <td>
                  <ul className="badge-list" aria-label="Tags">
                    {alert.tags.length === 0 ? (
                      <li className="muted">-</li>
                    ) : (
                      alert.tags.map((tag) => (
                        <li key={tag} className="group-badge">{tag}</li>
                      ))
                    )}
                  </ul>
                </td>
                <td>{alert.status}</td>
                <td className="table-actions">
                  {canModify && alert.status === "open" && (
                    <button type="button" onClick={() => onAcknowledge(alert.id)}>Acknowledge</button>
                  )}
                  {canModify && alert.status === "open" && (
                    <button type="button" onClick={() => onResolve(alert.id)}>Resolve</button>
                  )}
                  {canModify && alert.status === "acknowledged" && (
                    <>
                      <button type="button" onClick={() => onResolve(alert.id)}>Resolve</button>
                      <button type="button" onClick={() => onReopen?.(alert.id)}>Reopen</button>
                    </>
                  )}
                  {canModify && alert.status === "resolved" && (
                    <button type="button" onClick={() => onReopen?.(alert.id)}>Reopen</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
