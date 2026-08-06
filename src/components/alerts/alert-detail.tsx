import type { AlertDetail as AlertDetailType } from "../../server/alerts/types";
import { RawJson } from "./raw-json";
import { AlertAnalysisPanel } from "./alert-analysis-panel";

export function AlertDetail({ alert, canAnalyze = false }: { alert: AlertDetailType; canAnalyze?: boolean }) {
  return (
    <article className="page-section alert-detail">
      <header className="panel alert-detail-header">
        <h1>{alert.ruleDescription}</h1>
        <p>{alert.status} · severity {alert.level}</p>
      </header>
      <AlertAnalysisPanel alertId={alert.id} canAnalyze={canAnalyze} />
      <dl className="panel detail-list">
        <div><dt>Agent</dt><dd>{alert.agentName ?? alert.agentId ?? "-"}</dd></div>
        <div><dt>Rule ID</dt><dd>{alert.ruleId ?? "-"}</dd></div>
        <div><dt>Groups</dt><dd>{alert.groups.join(", ") || "-"}</dd></div>
        <div><dt>Tags</dt><dd>
          {alert.tags.length === 0
            ? <span className="muted">-</span>
            : alert.tags.map((tag) => <span key={tag} className="group-badge">{tag}</span>)}
        </dd></div>
        <div><dt>Received</dt><dd>{formatDate(alert.ingestedAt)}</dd></div>
      </dl>
      <section className="panel detail-section">
        <h2>Timeline</h2>
        <ol>{alert.timeline.map((event) => <li key={event.id}>{event.toStatus} · {formatDate(event.occurredAt)}</li>)}</ol>
      </section>
      <section className="panel detail-section">
        <h2>Raw payload</h2>
        <RawJson value={alert.rawPayload} />
      </section>
    </article>
  );
}

function formatDate(value: Date | string | null | undefined): string {
  if (value == null) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return date.toISOString();
}
