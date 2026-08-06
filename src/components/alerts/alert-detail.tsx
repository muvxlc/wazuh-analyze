import type { AlertDetail as AlertDetailType } from "../../server/alerts/types";
import { RawJson } from "./raw-json";

export function AlertDetail({ alert }: { alert: AlertDetailType }) {
  return <article>
    <header><h1>{alert.ruleDescription}</h1><p>{alert.status} · severity {alert.level}</p></header>
    <dl><dt>Agent</dt><dd>{alert.agentName ?? alert.agentId ?? "-"}</dd><dt>Rule ID</dt><dd>{alert.ruleId ?? "-"}</dd><dt>Received</dt><dd>{alert.ingestedAt.toISOString()}</dd></dl>
    <h2>Timeline</h2><ol>{alert.timeline.map((event) => <li key={event.id}>{event.toStatus} · {event.occurredAt.toISOString()}</li>)}</ol>
    <h2>Raw payload</h2><RawJson value={alert.rawPayload} />
  </article>;
}
