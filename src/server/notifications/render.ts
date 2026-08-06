import "server-only";

export interface RenderedMessage {
  title: string;
  body: string;
  severity: string;
  url: string;
}

export type NotificationEventType =
  | "alert.high_severity"
  | "incident.created"
  | "incident.escalated"
  | "verdict.confident_real"
  | "report.weekly";

export interface NotificationEvent {
  type: NotificationEventType;
  targetId: string;
  severity?: string | number;
  title: string;
  summary?: string;
}

export function renderNotification(
  event: NotificationEvent,
  baseAppUrl = process.env.APP_URL || "http://localhost:3000",
): RenderedMessage {
  // ponytail: Simple deterministic formatting rules without external templating engine.
  const appUrl = baseAppUrl.replace(/\/$/, "");
  const isAlert = event.type === "alert.high_severity" || event.type === "verdict.confident_real";
  const isReport = event.type === "report.weekly";
  const url = isAlert ? `${appUrl}/alerts/${event.targetId}` : isReport ? `${appUrl}/dashboard` : `${appUrl}/incidents/${event.targetId}`;

  let titlePrefix = "🚨 [Wazuh Alert]";
  if (event.type === "incident.created") titlePrefix = "⚠️ [New Incident]";
  else if (event.type === "incident.escalated") titlePrefix = "🔥 [Incident Escalated]";
  else if (event.type === "verdict.confident_real") titlePrefix = "🤖 [Confirmed Threat]";
  else if (isReport) titlePrefix = "📊 [Weekly Report]";

  const severityStr = event.severity !== undefined && event.severity !== null ? String(event.severity) : "N/A";

  return {
    title: `${titlePrefix} ${event.title}`,
    body: `${event.summary || "No summary provided."}\nSeverity: ${severityStr}\nLink: ${url}`,
    severity: severityStr,
    url,
  };
}
