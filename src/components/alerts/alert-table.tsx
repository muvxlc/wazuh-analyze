import Link from "next/link";
import type { AlertRecord, AlertGroupRow } from "../../server/alerts/types";
import { SEVERITY_COLORS, severityFromLevel, severityLabel } from "../../server/alerts/severity-mapper";
import { formatRelativeTime, formatAbsoluteTime, isNew } from "../../lib/relative-time";

export function AlertTable({
  status,
  alerts,
  now,
  onAcknowledge,
  onResolve,
  onReopen,
  canModify,
  onOpenDetail,
  grouped = false,
  groups,
  groupMembers,
  expandedKeys,
  onToggleGroup,
  loadingGroupKey,
}: {
  status: "loading" | "success" | "error" | "stale";
  alerts: readonly AlertRecord[];
  now: number;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onReopen?: (id: string) => void;
  canModify: boolean;
  onOpenDetail?: (alert: AlertRecord) => void;
  grouped?: boolean;
  groups?: readonly AlertGroupRow[];
  groupMembers?: Record<string, AlertRecord[]>;
  expandedKeys?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
  loadingGroupKey?: string | null;
}) {
  if (status === "loading") return <p role="status">Loading alerts…</p>;
  if (status === "error") return <p role="alert">Failed to load alerts</p>;
  if (grouped ? !groups?.length : alerts.length === 0) {
    return <p>No alerts match the current filters.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="alert-grid-table">
        <caption className="sr-only">Security alerts</caption>
        <thead>
          <tr>
            <th>Alert</th>
            <th>Severity</th>
            <th className="col-time">Time</th>
            <th>Status</th>
            <th className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {grouped
            ? groups!.map((group) => (
                <GroupRows
                  key={group.key}
                  group={group}
                  now={now}
                  members={groupMembers?.[group.key]}
                  expanded={expandedKeys?.has(group.key) ?? false}
                  loading={loadingGroupKey === group.key}
                  onToggle={onToggleGroup}
                  canModify={canModify}
                  onAcknowledge={onAcknowledge}
                  onResolve={onResolve}
                  onReopen={onReopen}
                  onOpenDetail={onOpenDetail}
                />
              ))
            : alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  now={now}
                  canModify={canModify}
                  onAcknowledge={onAcknowledge}
                  onResolve={onResolve}
                  onReopen={onReopen}
                  onOpenDetail={onOpenDetail}
                />
              ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertRow({
  alert,
  now,
  canModify,
  onAcknowledge,
  onResolve,
  onReopen,
  onOpenDetail,
}: {
  alert: AlertRecord;
  now: number;
  canModify: boolean;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onReopen?: (id: string) => void;
  onOpenDetail?: (alert: AlertRecord) => void;
}) {
  const severity = severityFromLevel(alert.level);
  const fresh = isNew(alert.ingestedAt, now);
  return (
    <tr className={fresh ? "row-new" : undefined}>
      <td>
        <div className="alert-title">
          {onOpenDetail ? (
            <button type="button" className="link-button" onClick={() => onOpenDetail(alert)}>
              {alert.ruleDescription}
            </button>
          ) : (
            <Link href={`/alerts/${alert.id}`}>{alert.ruleDescription}</Link>
          )}
          {fresh && <span className="new-dot" aria-label="new" />}
        </div>
        <small className="table-meta">
          {alert.agentName ?? alert.agentId ?? "-"} · {alert.ruleId ?? "-"}
        </small>
      </td>
      <td>
        <span
          className="severity-badge"
          aria-label={`severity ${severityLabel(severity)}, level ${alert.level}`}
          style={{ backgroundColor: SEVERITY_COLORS[severity], color: "var(--color-on-dark)" }}
        >
          {severityLabel(severity)}
        </span>
      </td>
      <td className="col-time" title={formatAbsoluteTime(alert.wazuhTimestamp)}>
        {formatRelativeTime(alert.wazuhTimestamp, now)}
      </td>
      <td>
        <span className={`status-pill status-${alert.status}`}>{alert.status}</span>
      </td>
      <td className="col-actions">
        <Actions
          status={alert.status}
          id={alert.id}
          canModify={canModify}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
          onReopen={onReopen}
        />
      </td>
    </tr>
  );
}

function GroupRows({
  group,
  now,
  members,
  expanded,
  loading,
  onToggle,
  canModify,
  onAcknowledge,
  onResolve,
  onReopen,
  onOpenDetail,
}: {
  group: AlertGroupRow;
  now: number;
  members?: AlertRecord[];
  expanded: boolean;
  loading: boolean;
  onToggle?: (key: string) => void;
  canModify: boolean;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onReopen?: (id: string) => void;
  onOpenDetail?: (alert: AlertRecord) => void;
}) {
  const severity = severityFromLevel(group.level);
  const fresh = isNew(group.lastSeen, now);
  return (
    <>
      <tr
        className={`group-row ${fresh ? "row-new" : ""}`}
        onClick={() => onToggle?.(group.key)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle?.(group.key);
          }
        }}
      >
        <td>
          <div className="alert-title">
            <span className={`expand-chevron ${expanded ? "expanded" : ""}`} aria-hidden>▶</span>
            <span>{group.ruleDescription}</span>
            <span className="group-count-badge" title={`${group.count} duplicates`}>×{group.count}</span>
            {group.openIncidentId && (
              <Link href={`/incidents/${group.openIncidentId}`} className="incident-chip" onClick={(e) => e.stopPropagation()}>
                incident
              </Link>
            )}
            {fresh && <span className="new-dot" aria-label="recent" />}
          </div>
          <small className="table-meta">
            {group.agentName ?? group.agentId ?? "-"} · rule {group.ruleId ?? "-"}
          </small>
        </td>
        <td>
          <span
            className="severity-badge"
            style={{ backgroundColor: SEVERITY_COLORS[severity], color: "var(--color-on-dark)" }}
          >
            {severityLabel(severity)}
          </span>
        </td>
        <td className="col-time" title={`${formatAbsoluteTime(group.firstSeen)} → ${formatAbsoluteTime(group.lastSeen)}`}>
          {formatRelativeTime(group.lastSeen, now)}
        </td>
        <td>
          <span className={`status-pill status-${group.status}`}>{group.status}</span>
          {group.incidentCount > 0 && <small className="table-meta"> · {group.incidentCount} inc</small>}
        </td>
        <td className="col-actions">
          {loading ? <small className="muted">…</small> : <small className="muted">{expanded ? "collapse" : "expand"}</small>}
        </td>
      </tr>
      {expanded && members?.map((alert) => (
        <tr key={alert.id} className="group-member-row">
          <td>
            <div className="alert-title">
              <span className="member-indent" aria-hidden>└</span>
              {onOpenDetail ? (
                <button type="button" className="link-button" onClick={() => onOpenDetail(alert)}>
                  {alert.ruleDescription}
                </button>
              ) : (
                <Link href={`/alerts/${alert.id}`}>{alert.ruleDescription}</Link>
              )}
            </div>
            <small className="table-meta">{formatAbsoluteTime(alert.wazuhTimestamp)}</small>
          </td>
          <td>
            <span className="severity-badge" style={{ backgroundColor: SEVERITY_COLORS[severityFromLevel(alert.level)], color: "var(--color-on-dark)" }}>
              {severityLabel(severityFromLevel(alert.level))}
            </span>
          </td>
          <td className="col-time" title={formatAbsoluteTime(alert.wazuhTimestamp)}>
            {formatRelativeTime(alert.wazuhTimestamp, now)}
          </td>
          <td>
            <span className={`status-pill status-${alert.status}`}>{alert.status}</span>
          </td>
          <td className="col-actions">
            <Actions
              status={alert.status}
              id={alert.id}
              canModify={canModify}
              onAcknowledge={onAcknowledge}
              onResolve={onResolve}
              onReopen={onReopen}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

function Actions({
  status,
  id,
  canModify,
  onAcknowledge,
  onResolve,
  onReopen,
}: {
  status: AlertRecord["status"];
  id: string;
  canModify: boolean;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onReopen?: (id: string) => void;
}) {
  if (!canModify) return null;
  return (
    <div className="table-actions" role="group" aria-label="Alert actions">
      {status === "open" && (
        <>
          <button type="button" onClick={() => onAcknowledge(id)}>Ack</button>
          <button type="button" onClick={() => onResolve(id)}>Resolve</button>
        </>
      )}
      {status === "acknowledged" && (
        <>
          <button type="button" onClick={() => onResolve(id)}>Resolve</button>
          <button type="button" onClick={() => onReopen?.(id)}>Reopen</button>
        </>
      )}
      {status === "resolved" && <button type="button" onClick={() => onReopen?.(id)}>Reopen</button>}
    </div>
  );
}
