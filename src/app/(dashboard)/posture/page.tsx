"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, ShieldCheck, FileWarning, Bug, Settings2 } from "lucide-react";

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

function itemLabel(item: unknown): string {
  if (typeof item !== "object" || item === null) return String(item);
  const row = item as Record<string, unknown>;
  return String(row.name ?? row.title ?? row.file ?? row.path ?? row.check ?? row.description ?? row.id ?? "-");
}

function rowsCount(value: unknown): number {
  return items(value).length;
}

function countFrom(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const data = (value as { data?: { total_affected_items?: unknown } }).data;
  const n = data?.total_affected_items;
  return typeof n === "number" ? n : null;
}

function trimmedJson(value: unknown, max = 40): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value.length > max ? value.slice(0, max) + "…" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value).slice(0, max) + (JSON.stringify(value).length > max ? "…" : "");
}

function FieldDetails({ row, fields }: { row: Record<string, unknown>; fields: string[] }) {
  const pairs = fields
    .filter((k) => row[k] !== undefined && row[k] !== null && row[k] !== "")
    .map((k) => [k, row[k]] as [string, unknown]);
  if (pairs.length === 0) return <span className="text-[var(--color-ink-muted)]">{trimmedJson(row)}</span>;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-ink-muted)]">
      {pairs.map(([k, v]) => (
        <span key={k} className="truncate">
          <span className="font-medium text-[var(--color-ink)]">{k}:</span>{" "}
          <span className="truncate">{trimmedJson(v)}</span>
        </span>
      ))}
    </div>
  );
}

const SCA_FIELDS = ["policy_id", "check", "rule", "description", "reason", "condition"];
const SYSCHECK_FIELDS = ["path", "filename", "event", "diff", "hash", "report_change"];
const ROOTCHECK_FIELDS = ["reason", "check", "description"];

function ItemList({ value, empty, fields }: { value: unknown; empty: string; fields: string[] }) {
  const rows = items(value);
  if (rows.length === 0) return <p className="p-4 text-sm text-[var(--color-ink-muted)]">{empty}</p>;
  return (
    <ul className="divide-y divide-[var(--color-border)] max-h-80 overflow-y-auto">
      {rows.map((row, i) => (
        <li key={i} className="p-3 text-sm">
          <p className="font-medium truncate">{itemLabel(row)}</p>
          {typeof row === "object" && row !== null ? (
            <FieldDetails row={row as Record<string, unknown>} fields={fields} />
          ) : (
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{String(row)}</p>
          )}
        </li>
      ))}
    </ul>
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
  }, [t]);

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
  }, [selectedAgent, refreshToken, t]);

  if (error && !snapshot) return <section className="page-section"><h1>{shell("posture")}</h1><p className="status-error p-4 mt-4">{error}</p></section>;
  if (!snapshot) return <section className="page-section"><h1>{shell("posture")}</h1><p className="panel p-4 mt-4" role="status">{t("loading")}</p></section>;

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1>{shell("posture")}</h1><p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p></div>
        <div className="flex items-center gap-2">
          <label htmlFor="posture-agent" className="sr-only">{t("agent")}</label>
          <select id="posture-agent" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className="text-sm border border-[var(--color-input-border)] bg-[var(--color-canvas)] rounded px-2 py-2">
            {snapshot.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.id})</option>)}
          </select>
          <button type="button" onClick={() => setRefreshToken((n) => n + 1)} disabled={loading} className="outline-button p-2" title={t("refresh")} aria-label={t("refresh")}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </header>

      {snapshot.stale && <p className="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm">{t("stale")}</p>}
      {snapshot.agents.length === 0 && <p className="panel p-6 text-center text-sm text-[var(--color-ink-muted)]">{t("no-agents")}</p>}
      {error && <p className="status-error p-3">{error}</p>}
      {data && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="panel overflow-hidden">
            <h2 className="flex items-center gap-2 border-b border-[var(--color-border)] p-4 text-base font-semibold"><Settings2 size={18} />{t("sca")}<span className="text-xs font-normal bg-[var(--color-canvas-soft)] border border-[var(--color-border)] px-2 py-0.5 rounded-full">{countFrom(data.sca) ?? rowsCount(data.sca)}</span></h2>
            <ItemList value={data.sca} empty={t("no-data")} fields={SCA_FIELDS} />
          </section>
          <section className="panel overflow-hidden">
            <h2 className="flex items-center gap-2 border-b border-[var(--color-border)] p-4 text-base font-semibold"><FileWarning size={18} />{t("fim")}<span className="text-xs font-normal bg-[var(--color-canvas-soft)] border border-[var(--color-border)] px-2 py-0.5 rounded-full">{countFrom(data.syscheck) ?? rowsCount(data.syscheck)}</span></h2>
            <ItemList value={data.syscheck} empty={t("no-data")} fields={SYSCHECK_FIELDS} />
          </section>
          <section className="panel overflow-hidden">
            <h2 className="flex items-center gap-2 border-b border-[var(--color-border)] p-4 text-base font-semibold"><Bug size={18} />{t("rootcheck")}<span className="text-xs font-normal bg-[var(--color-canvas-soft)] border border-[var(--color-border)] px-2 py-0.5 rounded-full">{countFrom(data.rootcheck) ?? rowsCount(data.rootcheck)}</span></h2>
            <ItemList value={data.rootcheck} empty={t("no-data")} fields={ROOTCHECK_FIELDS} />
          </section>
        </div>
      )}
      {loading && <p className="text-sm text-[var(--color-ink-muted)] flex items-center gap-2" role="status"><RefreshCw className="animate-spin" size={16} />{t("loading")}</p>}
    </section>
  );
}
