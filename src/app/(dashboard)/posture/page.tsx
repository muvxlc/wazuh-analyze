"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Settings2, FileWarning, Bug, CheckCircle2, XCircle } from "lucide-react";

interface Agent { id: string; name: string; status?: string; }
interface Snapshot { agents: Agent[]; stale: boolean; }
interface PostureData { agentId: string; sca: unknown; syscheck: unknown; rootcheck: unknown; }

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  const data = (value as { data?: unknown }).data;
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null && Array.isArray((data as { affected_items?: unknown }).affected_items)) {
    return (data as { affected_items: unknown[] }).affected_items;
  }
  return [];
}

function rowsCount(value: unknown): number { return items(value).length; }
function countFrom(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const data = (value as { data?: { total_affected_items?: unknown; total_count?: unknown } }).data;
  const n = data?.total_affected_items ?? data?.total_count;
  return typeof n === "number" ? n : null;
}

function str(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

/** SCA result: compliance=1/pass → green check, 0/fail → red X. */
function ScaResult({ row }: { row: Record<string, unknown> }) {
  const raw = row.result ?? row.compliance ?? row.status;
  const pass = Number(raw) === 1 || /pass|ok|compliant|valid/i.test(String(raw ?? ""));
  const fail = Number(raw) === 0 || /fail|not|invalid|error/i.test(String(raw ?? ""));
  if (!pass && !fail) return <span className="text-[var(--color-ink-muted)]">{str(raw)}</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${pass ? "text-green-700" : "text-red-700"}`}>
      {pass ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
      {pass ? "Pass" : "Fail"}
    </span>
  );
}

/** FIM event: inserted/deleted/modified → colored badge. */
function fimBadge(event: unknown): { label: string; cls: string } | null {
  const e = String(event ?? "").toLowerCase();
  if (!e) return null;
  if (/insert|creat|added|new/.test(e)) return { label: str(event), cls: "bg-green-100 text-green-700" };
  if (/delet|remov/.test(e)) return { label: str(event), cls: "bg-red-100 text-red-700" };
  if (/modif|chang|updat/.test(e)) return { label: str(event), cls: "bg-yellow-100 text-yellow-700" };
  return { label: str(event), cls: "bg-gray-100 text-gray-600" };
}

interface Column { label: string; render: (row: Record<string, unknown>) => ReactNode; }

const SCA_COLUMNS: Column[] = [
  { label: "Check", render: (r) => <span className="font-medium">{str(r.title ?? r.check ?? r.description ?? r.rule)}</span> },
  { label: "Policy", render: (r) => <span className="text-xs text-[var(--color-ink-muted)]">{str(r.policy_id ?? r.policy)}</span> },
  { label: "Result", render: (r) => <ScaResult row={r} /> },
  { label: "Reason", render: (r) => <span className="text-xs text-[var(--color-ink-muted)] truncate block max-w-xs" title={str(r.reason ?? r.rationale)}>{str(r.reason ?? r.rationale)}</span> },
];

const FIM_COLUMNS: Column[] = [
  { label: "Path", render: (r) => <span className="font-mono text-xs break-all">{str(r.path ?? r.file ?? r.filename)}</span> },
  { label: "Event", render: (r) => {
    const b = fimBadge(r.event);
    return b ? <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${b.cls}`}>{b.label}</span> : <span className="text-[var(--color-ink-muted)]">-</span>;
  } },
  { label: "Changed", render: (r) => <span className="text-xs text-[var(--color-ink-muted)]">{str(r.size ? `${r.size} bytes` : (r.diff ?? r.hash ?? null))}</span> },
  { label: "Date", render: (r) => <span className="text-xs text-[var(--color-ink-muted)]">{str(r.date ?? r.mtime ?? r.timestamp)}</span> },
];

/** Wazuh rootcheck: passed=true → green, passed=false → red, missing → dash. */
function rcStatus(r: Record<string, unknown>): ReactNode {
  const v = r.passed;
  if (v === true) return <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Passed</span>;
  if (v === false) return <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Failed</span>;
  return <span className="text-[var(--color-ink-muted)]">-</span>;
}

const RC_COLUMNS: Column[] = [
  { label: "Check", render: (r) => <span className="font-medium">{str(r.check ?? r.title ?? r.description)}</span> },
  { label: "Status", render: (r) => rcStatus(r) },
  { label: "Remediation", render: (r) => <span className="text-xs text-[var(--color-ink-muted)] truncate block max-w-xs" title={str(r.remediation ?? r.reason ?? null)}>{str(r.remediation ?? r.reason ?? null)}</span> },
];

interface SectionPanelProps {
  icon: typeof Settings2;
  title: string;
  subtitle: string;
  value: unknown;
  empty: string;
  columns: Column[];
  rowCapNotice: string;
  passCount?: number;
  failCount?: number;
}

function SectionPanel({ icon: Icon, title, subtitle, value, empty, columns, rowCapNotice, passCount, failCount }: SectionPanelProps) {
  const rows = items(value);
  return (
    <section className="panel overflow-hidden" aria-label={title}>
      <header className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-3 bg-[var(--color-canvas-soft)]">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon size={16} aria-hidden="true" />{title}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{subtitle}</p>
        </div>
        {(passCount !== undefined || failCount !== undefined) && (
          <div className="flex items-center gap-3 text-xs">
            {passCount !== undefined && <span className="text-green-700">✓ {passCount}</span>}
            {failCount !== undefined && <span className="text-red-700">✗ {failCount}</span>}
          </div>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        <div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>{columns.map((c) => <th key={c.label} className="th" scope="col">{c.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-hairline-cool)]">
                {rows.slice(0, 50).map((row, i) => {
                  const r = (typeof row === "object" && row !== null ? row : { value: row }) as Record<string, unknown>;
                  return (
                    <tr key={`row-${i}`} className="hover:bg-[var(--color-canvas-soft)] transition-colors">
                      {columns.map((c) => <td key={c.label} className="td py-2 align-top">{c.render(r)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && <p className="border-t border-[var(--color-hairline)] px-4 py-2 text-xs text-[var(--color-ink-muted)]" role="status">{rowCapNotice}</p>}
        </div>
      )}
    </section>
  );
}

export default function PosturePage() {
  const t = useTranslations("posture");
  const shell = useTranslations("shell");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [data, setData] = useState<PostureData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/agents")
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("agents")))
        .then((body: { data: Snapshot }) => {
          setSnapshot(body.data);
          if (body.data.agents[0]) setSelectedAgent(body.data.agents[0].id);
        })
        .catch(() => setError(t("load-error")));
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedAgent) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setData(null);
      fetch(`/api/posture/${encodeURIComponent(selectedAgent)}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("posture")))
        .then((body: { data: PostureData }) => { setData(body.data); setError(null); })
        .catch(() => setError(t("load-error")))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent, refreshToken]);

  const scaRows = items(data?.sca);
  const scaPass = scaRows.filter((r) => { const v = (r as Record<string, unknown>).result ?? (r as Record<string, unknown>).compliance; return Number(v) === 1 || /pass|ok|compliant|valid/i.test(String(v ?? "")); }).length;
  const scaFail = scaRows.filter((r) => { const v = (r as Record<string, unknown>).result ?? (r as Record<string, unknown>).compliance; return Number(v) === 0 || /fail|not|invalid|error/i.test(String(v ?? "")); }).length;
  const scaTotal = scaPass + scaFail;
  const scaScore = scaTotal > 0 ? Math.round((scaPass / scaTotal) * 100) : 0;

  const scaCount = countFrom(data?.sca) ?? scaRows.length;
  const fimCount = countFrom(data?.syscheck) ?? rowsCount(data?.syscheck);
  const rcCount = countFrom(data?.rootcheck) ?? rowsCount(data?.rootcheck);

  if (error && !snapshot) return <section className="page-section"><h1>{shell("posture")}</h1><p className="status-error p-4 mt-4" role="alert">{error}</p></section>;
  if (!snapshot) return <section className="page-section"><h1>{shell("posture")}</h1><p className="panel p-4 mt-4" role="status">{t("loading")}</p></section>;

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1>{shell("posture")}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="posture-agent" className="sr-only">{t("agent")}</label>
          <select
            id="posture-agent"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="text-sm border border-[var(--color-hairline)] bg-[var(--color-canvas)] rounded px-2 py-1.5 h-9 min-w-[200px]"
          >
            {snapshot.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.id})</option>)}
          </select>
          <button type="button" onClick={() => setRefreshToken((n) => n + 1)} disabled={loading} className="outline-button p-2 h-9" title={t("refresh")} aria-label={t("refresh")}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <div className="panel p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" role="group" aria-label={t("summary")}>
        <span className="flex items-center gap-1.5"><Settings2 size={14} className="text-[var(--color-ink-muted)]" aria-hidden="true" /><span className="text-[var(--color-ink-muted)]">{t("sca-label")}</span><span className="font-semibold">{scaCount}</span></span>
        {scaRows.length > 0 && (<><span className="text-green-700 text-xs">✓ {scaPass}</span><span className="text-red-700 text-xs">✗ {scaFail}</span></>)}
        {scaTotal > 0 && (
          <div className="flex items-center gap-2" role="meter" aria-label={t("sca-score")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={scaScore}>
            <div className="h-2 w-20 overflow-hidden rounded-full bg-[var(--color-danger)]" aria-hidden="true">
              <div className="h-full bg-[var(--color-primary-deep)]" style={{ width: `${scaScore}%` }} />
            </div>
            <span className="text-xs font-semibold tabular-nums">{scaScore}%</span>
          </div>
        )}
        <span className="flex items-center gap-1.5"><FileWarning size={14} className="text-[var(--color-ink-muted)]" aria-hidden="true" /><span className="text-[var(--color-ink-muted)]">{t("fim-label")}</span><span className="font-semibold">{fimCount}</span></span>
        <span className="flex items-center gap-1.5"><Bug size={14} className="text-[var(--color-ink-muted)]" aria-hidden="true" /><span className="text-[var(--color-ink-muted)]">{t("rootcheck-label")}</span><span className="font-semibold">{rcCount}</span></span>
      </div>

      {snapshot.stale && <p className="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm" role="alert">{t("stale")}</p>}
      {snapshot.agents.length === 0 && <p className="panel p-6 text-center text-sm text-[var(--color-ink-muted)]">{t("no-agents")}</p>}
      {error && <p className="status-error p-3" role="alert">{error}</p>}
      {!data && loading && <p className="text-sm text-[var(--color-ink-muted)] flex items-center gap-2" role="status"><RefreshCw className="animate-spin" size={16} />{t("loading")}</p>}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionPanel icon={Settings2} title={t("sca")} subtitle={t("sca-subtitle")} value={data.sca} empty={t("no-data")} columns={SCA_COLUMNS} rowCapNotice={t("showing-count", { count: 50, total: Math.max(scaCount, scaRows.length) })} passCount={scaPass} failCount={scaFail} />
          <SectionPanel icon={FileWarning} title={t("fim")} subtitle={t("fim-subtitle")} value={data.syscheck} empty={t("no-data")} columns={FIM_COLUMNS} rowCapNotice={t("showing-count", { count: 50, total: Math.max(fimCount, rowsCount(data.syscheck)) })} />
          <SectionPanel icon={Bug} title={t("rootcheck")} subtitle={t("rootcheck-subtitle")} value={data.rootcheck} empty={t("no-data")} columns={RC_COLUMNS} rowCapNotice={t("showing-count", { count: 50, total: Math.max(rcCount, rowsCount(data.rootcheck)) })} />
        </div>
      )}
    </section>
  );
}
