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
  | "incident.opened"
  | "verdict.confident_real"
  | "report.weekly"
  | "vulnerability.analysis_completed";

export interface NotificationEvent {
  type: NotificationEventType;
  targetId: string;
  severity?: string | number;
  title: string;
  summary?: string;
  // Vulnerability AI sectioned output (bounded English + Thai pairs)
  sections?: Partial<{
    summaryImpact: { en: string; th: string };
    cveDetails: { en: string; th: string };
    attackConditions: { en: string; th: string };
    riskAssessment: { en: string; th: string };
    remediation: { en: string[]; th: string[] };
    postFixVerification: { en: string[]; th: string[] };
    unknowns: { en: string[]; th: string[] };
  }>;
  // Vulnerability deep-link keys (not exposed in rendered body)
  agentId?: string;
  sourceId?: string;
  cve?: string;
}

// Seven canonical sections — matches incident-vulnerability heading contract.
// ponytail: add more sections here only if incident rendering gains equivalents;
// do not rename existing entries without updating incident template too.
const VULN_SECTION_KEYS: Array<keyof NonNullable<NotificationEvent["sections"]>> = [
  "summaryImpact",
  "cveDetails",
  "attackConditions",
  "riskAssessment",
  "remediation",
  "postFixVerification",
  "unknowns",
];

const SECTION_LABELS: Record<
  keyof NonNullable<NotificationEvent["sections"]>,
  { en: string; th: string }
> = {
  summaryImpact: { en: "Summary & Impact", th: "สรุปและผลกระทบ" },
  cveDetails: { en: "CVE Details", th: "รายละเอียด CVE" },
  attackConditions: { en: "Attack Conditions", th: "เงื่อนไขการโจมตี" },
  riskAssessment: { en: "Risk Assessment", th: "การประเมินความเสี่ยง" },
  remediation: { en: "Remediation", th: "การแก้ไข" },
  postFixVerification: { en: "Post-Fix Verification", th: "การตรวจสอบหลังแก้ไข" },
  unknowns: { en: "Unknown Information", th: "ข้อมูลที่ยังไม่ทราบ" },
};

export function renderNotification(
  event: NotificationEvent,
  baseAppUrl = process.env.APP_URL || "http://localhost:3000",
): RenderedMessage {
  // ponytail: Simple deterministic formatting rules without external templating engine.
  const appUrl = baseAppUrl.replace(/\/$/, "");
  const isAlert = event.type === "alert.high_severity" || event.type === "verdict.confident_real";
  const isReport = event.type === "report.weekly";
  const isVuln = event.type === "vulnerability.analysis_completed";
  let url: string;
  if (isAlert) url = `${appUrl}/alerts/${event.targetId}`;
  else if (isReport) url = `${appUrl}/dashboard`;
  else if (isVuln) url = `${appUrl}/vulnerabilities/${event.agentId ?? event.targetId}/${event.sourceId ?? event.targetId}`;
  else url = `${appUrl}/incidents/${event.targetId}`;

  let titlePrefix = "🚨 [Wazuh Alert]";
  if (event.type === "incident.created") titlePrefix = "⚠️ [New Incident]";
  else if (event.type === "incident.escalated") titlePrefix = "🔥 [Incident Escalated]";
  else if (event.type === "incident.opened") titlePrefix = "🔄 [Incident Reopened]";
  else if (event.type === "verdict.confident_real") titlePrefix = "🤖 [Confirmed Threat]";
  else if (isReport) titlePrefix = "📊 [Weekly Report]";
  else if (isVuln) titlePrefix = "⚠️ [Vulnerability Analysis]";

  const severityStr = event.severity !== undefined && event.severity !== null ? String(event.severity) : "N/A";

  if (isVuln) {
    const sections = event.sections;
    const cveLine = event.cve ? `CVE: ${event.cve}\n` : "";
    const agentLine = event.agentId ? `Agent: ${event.agentId}\n` : "";
    const sourceLine = event.sourceId ? `Source: ${event.sourceId}\n` : "";
    const summaryLine = event.summary ? `${event.summary}\n\n` : "";
    const bodyLines = [
      `${summaryLine}Severity: ${severityStr}`,
      cveLine,
      agentLine,
      sourceLine,
      `Link: ${url}`,
    ].filter(Boolean);

    const sectionParts: string[] = [];
    if (sections) {
      for (const key of VULN_SECTION_KEYS) {
        const value = sections[key];
        if (!value) continue;
        const label = SECTION_LABELS[key];
        if (Array.isArray(value.en)) {
          // remediation / postFixVerification / unknowns are paired arrays
          const maxLen = Math.min(value.en.length, value.th.length);
          const pairs: string[] = [];
          for (let i = 0; i < maxLen; i++) {
            if (value.en[i] && value.th[i]) pairs.push(`${value.en[i]} | ${value.th[i]}`);
          }
          if (pairs.length) sectionParts.push(`**${label.en} / ${label.th}**\n${pairs.join("\n")}`);
        } else if (typeof value.en === "string" && typeof value.th === "string") {
          sectionParts.push(`**${label.en} / ${label.th}**\n${value.en} | ${value.th}`);
        }
      }
    }
    const body = [...bodyLines, ...sectionParts].join("\n");
    return { title: `${titlePrefix} ${event.title}`, body, severity: severityStr, url };
  }

  return {
    title: `${titlePrefix} ${event.title}`,
    body: `${event.summary || "No summary provided."}\nSeverity: ${severityStr}\nLink: ${url}`,
    severity: severityStr,
    url,
  };
}
