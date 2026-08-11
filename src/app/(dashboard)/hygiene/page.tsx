"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Cpu, Monitor, Package, Activity, Network, Server } from "lucide-react";

interface Agent { id: string; name: string; status?: string; }
interface Snapshot { agents: Agent[]; stale: boolean; }

interface HygieneData {
  agentId: string;
  hardware: unknown;
  os: unknown;
  packages: unknown;
  processes: unknown;
  ports: unknown;
  services: unknown;
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  const data = (value as { data?: unknown }).data;
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null && Array.isArray((data as { affected_items?: unknown }).affected_items)) {
    return (data as { affected_items: unknown[] }).affected_items;
  }
  return [];
}

function extractTotal(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const data = (value as { data?: { total_affected_items?: unknown } }).data;
  const n = data?.total_affected_items;
  return typeof n === "number" ? n : null;
}

function itemLabel(item: unknown): string {
  if (typeof item !== "object" || item === null) return String(item);
  const row = item as Record<string, unknown>;
  return String(row.name ?? row.title ?? row.cmd ?? row.file ?? row.description ?? row.id ?? "-");
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

const PANEL_FIELDS: Record<string, string[]> = {
  Package: ["name", "version", "architecture", "vendor", "description"],
  Activity: ["pid", "name", "cmdline", "state", "user"],
  Network: ["protocol", "state", "pid", "process", "local_ip", "local_port"],
  Server: ["name", "state", "start_mode", "description"],
  Cpu: ["cpu_name", "cpu_mhz", "memory", "ram", "total_memory"],
  Monitor: ["hostname", "os_name", "os_release", "os_version", "os_codename", "kernel"],
};

function Panel({
  icon: Icon, title, value, empty,
}: { icon: typeof Cpu; title: string; value: unknown; empty: string }) {
  const rows = extractItems(value);
  const total = extractTotal(value);
  return (
    <section className="panel overflow-hidden flex flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] p-4 bg-[var(--color-canvas-soft)]">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Icon size={18} />{title}</h2>
        {total !== null && <span className="text-xs font-semibold bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-1 rounded-full">{total}</span>}
      </header>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] max-h-80 overflow-y-auto">
          {rows.slice(0, 50).map((row, i) => {
            const fields = PANEL_FIELDS[Icon.name] ?? [];
            return (
              <li key={i} className="p-3 text-sm">
                <p className="font-medium truncate">{itemLabel(row)}</p>
                {typeof row === "object" && row !== null ? (
                  <FieldDetails row={row as Record<string, unknown>} fields={fields} />
                ) : (
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{String(row)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: unknown }) {
  const total = extractTotal(value);
  return (
    <div className="panel p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-[var(--color-canvas-soft)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
        <Icon size={18} className="text-[var(--color-primary-deep)]" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--color-ink-muted)] truncate">{label}</p>
        <p className="text-lg font-bold">{total ?? "-"}</p>
      </div>
    </div>
  );
}

export default function HygienePage() {
  const t = useTranslations("hygiene");
  const shell = useTranslations("shell");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [data, setData] = useState<HygieneData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/agents")
        .then((r) => r.ok ? r.json() : Promise.reject(new Error("agents")))
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
      fetch(`/api/hygiene/${encodeURIComponent(selectedAgent)}`)
        .then((r) => r.ok ? r.json() : Promise.reject(new Error("hygiene")))
        .then((body: { data: HygieneData }) => { setData(body.data); setError(null); })
        .catch(() => setError(t("load-error")))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedAgent, refreshToken, t]);

  if (error && !snapshot) return <section className="page-section"><h1>{shell("hygiene")}</h1><p className="status-error p-4 mt-4">{error}</p></section>;
  if (!snapshot) return <section className="page-section"><h1>{shell("hygiene")}</h1><p className="panel p-4 mt-4" role="status">{t("loading")}</p></section>;

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1>{shell("hygiene")}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="hygiene-agent" className="sr-only">{t("agent")}</label>
          <select id="hygiene-agent" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className="text-sm border border-[var(--color-input-border)] bg-[var(--color-canvas)] rounded px-2 py-2">
            {snapshot.agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
          </select>
          <button type="button" onClick={() => setRefreshToken((n) => n + 1)} disabled={loading} className="outline-button p-2" title={t("refresh")} aria-label={t("refresh")}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      {snapshot.stale && <p className="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm">{t("stale")}</p>}
      {snapshot.agents.length === 0 && <p className="panel p-6 text-center text-sm text-[var(--color-ink-muted)]">{t("no-agents")}</p>}
      {error && <p className="status-error p-3">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryCard icon={Package} label={t("packages")} value={data.packages} />
            <SummaryCard icon={Activity} label={t("processes")} value={data.processes} />
            <SummaryCard icon={Network} label={t("ports")} value={data.ports} />
            <SummaryCard icon={Server} label={t("services")} value={data.services} />
            <SummaryCard icon={Cpu} label={t("hardware")} value={data.hardware} />
            <SummaryCard icon={Monitor} label={t("os")} value={data.os} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3 items-start">
            <Panel icon={Package} title={t("packages")} value={data.packages} empty={t("no-data")} />
            <Panel icon={Activity} title={t("processes")} value={data.processes} empty={t("no-data")} />
            <Panel icon={Network} title={t("ports")} value={data.ports} empty={t("no-data")} />
            <Panel icon={Server} title={t("services")} value={data.services} empty={t("no-data")} />
            <Panel icon={Cpu} title={t("hardware")} value={data.hardware} empty={t("no-data")} />
            <Panel icon={Monitor} title={t("os")} value={data.os} empty={t("no-data")} />
          </div>
        </>
      )}

      {loading && <p className="text-sm text-[var(--color-ink-muted)] flex items-center gap-2" role="status"><RefreshCw className="animate-spin" size={16} />{t("loading")}</p>}
    </section>
  );
}
