"use client";

import { useEffect, useState, type ReactNode } from "react";
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

/** Format byte values (Wazuh reports memory in bytes). Falls back gracefully. */
function formatBytes(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Format MHz/GHz clock speed. */
function formatMhz(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return n >= 1000 ? `${(n / 1000).toFixed(2)} GHz` : `${Math.round(n)} MHz`;
}

function str(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

/** Normalize process/port/service state to a semantic status + css class. */
function stateBadge(state: unknown): { label: string; cls: string } {
  const s = String(state ?? "").toLowerCase();
  if (/(run|active|estab|valid|on)/.test(s)) return { label: str(state), cls: "bg-green-100 text-green-700" };
  if (/(stop|error|fail|dead|zombie|close|off)/.test(s)) return { label: str(state), cls: "bg-red-100 text-red-700" };
  if (/(listen|wait|sleep|idle|pend|pause)/.test(s)) return { label: str(state), cls: "bg-yellow-100 text-yellow-700" };
  return { label: str(state), cls: "bg-gray-100 text-gray-600" };
}

function Badge({ state }: { state: unknown }) {
  const { label, cls } = stateBadge(state);
  if (label === "-") return <span className="text-[var(--color-ink-muted)]">-</span>;
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
}

interface Column {
  label: string;
  render: (row: Record<string, unknown>) => ReactNode;
  width?: string;
}

function nested(row: Record<string, unknown>, parent: string, child: string): unknown {
  const p = row[parent];
  return typeof p === "object" && p !== null ? (p as Record<string, unknown>)[child] : undefined;
}

/** Build an ip:port display for network rows. */
function netAddr(row: Record<string, unknown>): string {
  const ip = str(row.local_ip ?? nested(row, "local", "ip"));
  const port = str(row.local_port ?? nested(row, "local", "port"));
  if (ip === "-" && port === "-") return "-";
  return `${ip}:${port}`;
}

const COLUMNS: Record<string, Column[]> = {
  os: [
    { label: "Hostname", render: (r) => str(r.hostname) },
    { label: "OS", render: (r) => str(r.os_name ?? r.name) },
    { label: "Version", render: (r) => str(r.os_release ?? r.os_version ?? r.version) },
    { label: "Kernel", render: (r) => str(r.kernel ?? r.os_release) },
    { label: "Arch", render: (r) => str(r.architecture ?? r.arch) },
  ],
  hardware: [
    { label: "CPU", render: (r) => str(r.cpu_name ?? r.name) },
    { label: "Cores", render: (r) => str(r.cores) },
    { label: "Speed", render: (r) => formatMhz(r.cpu_mhz ?? r.frequency) },
    { label: "RAM", render: (r) => formatBytes(nested(r, "ram", "total") ?? r.ram ?? r.memory) },
    { label: "Disk", render: (r) => formatBytes(nested(r, "disk", "total") ?? r.disk_total) },
  ],
  packages: [
    { label: "Package", render: (r) => <span className="font-medium">{str(r.name)}</span> },
    { label: "Version", render: (r) => str(r.version) },
    { label: "Vendor", render: (r) => <span className="text-[var(--color-ink-muted)]">{str(r.vendor)}</span> },
    { label: "Arch", render: (r) => str(r.architecture ?? r.format) },
  ],
  processes: [
    { label: "PID", render: (r) => <span className="font-mono text-xs">{str(r.pid)}</span> },
    { label: "Process", render: (r) => <span className="font-medium">{str(r.name)}</span> },
    { label: "User", render: (r) => str(r.user) },
    { label: "State", render: (r) => <Badge state={r.state} /> },
    { label: "Command", render: (r) => <span className="text-xs text-[var(--color-ink-muted)] truncate block max-w-xs" title={str(r.cmd ?? r.cmdline)}>{str(r.cmd ?? r.cmdline)}</span> },
  ],
  ports: [
    { label: "Protocol", render: (r) => <span className="font-mono text-xs uppercase">{str(r.protocol)}</span> },
    { label: "Local", render: (r) => <span className="font-mono text-xs">{netAddr(r)}</span> },
    { label: "Process", render: (r) => str(r.process ?? r.name) },
    { label: "State", render: (r) => <Badge state={r.state} /> },
    { label: "PID", render: (r) => <span className="font-mono text-xs">{str(r.pid)}</span> },
  ],
  services: [
    { label: "Service", render: (r) => <span className="font-medium">{str(r.name)}</span> },
    { label: "State", render: (r) => <Badge state={r.state} /> },
    { label: "Start", render: (r) => str(r.start_mode) },
    { label: "Description", render: (r) => <span className="text-xs text-[var(--color-ink-muted)] truncate block max-w-xs" title={str(r.description)}>{str(r.description)}</span> },
  ],
};

function SectionPanel({
  icon: Icon, title, value, empty, columnsKey,
}: {
  icon: typeof Cpu; title: string; value: unknown; empty: string; columnsKey: keyof typeof COLUMNS;
}) {
  const rows = extractItems(value);
  const total = extractTotal(value);
  const columns = COLUMNS[columnsKey] ?? [];
  return (
    <section className="panel overflow-hidden" aria-label={title}>
      <header className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-3 bg-[var(--color-canvas-soft)]">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon size={16} aria-hidden="true" />{title}
          {total !== null && <span className="text-xs font-normal text-[var(--color-ink-muted)]">({total} total)</span>}
        </h2>
      </header>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.label} className="th" scope="col">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-hairline-cool)]">
              {rows.slice(0, 50).map((row, i) => {
                const r = (typeof row === "object" && row !== null ? row : { value: row }) as Record<string, unknown>;
                return (
                  <tr key={`row-${i}`} className="hover:bg-[var(--color-canvas-soft)] transition-colors">
                    {columns.map((c) => (
                      <td key={c.label} className="td py-2 align-top">{c.render(r)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent, refreshToken]);

  if (error && !snapshot) return <section className="page-section"><h1>{shell("hygiene")}</h1><p className="status-error p-4 mt-4" role="alert">{error}</p></section>;
  if (!snapshot) return <section className="page-section"><h1>{shell("hygiene")}</h1><p className="panel p-4 mt-4" role="status">{t("loading")}</p></section>;

  const totals = [
    { icon: Monitor, label: t("os"), n: extractTotal(data?.os) ?? extractItems(data?.os).length },
    { icon: Cpu, label: t("hardware"), n: extractTotal(data?.hardware) ?? extractItems(data?.hardware).length },
    { icon: Package, label: t("packages"), n: extractTotal(data?.packages) ?? extractItems(data?.packages).length },
    { icon: Activity, label: t("processes"), n: extractTotal(data?.processes) ?? extractItems(data?.processes).length },
    { icon: Network, label: t("ports"), n: extractTotal(data?.ports) ?? extractItems(data?.ports).length },
    { icon: Server, label: t("services"), n: extractTotal(data?.services) ?? extractItems(data?.services).length },
  ];

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1>{shell("hygiene")}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <label htmlFor="hygiene-agent" className="sr-only">{t("agent")}</label>
          <select
            id="hygiene-agent"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="rounded w-full sm:w-auto sm:min-w-[12rem] max-w-[16rem]"
          >
            {snapshot.agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
          </select>
          <button
            type="button"
            onClick={() => setRefreshToken((n) => n + 1)}
            disabled={loading}
            className="outline-button p-2 h-9"
            title={t("refresh")}
            aria-label={t("refresh")}
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <div className="panel p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" role="group" aria-label={t("summary")}>
        {totals.map(({ icon: Icon, label, n }) => (
          <span key={label} className="flex items-center gap-1.5">
            <Icon size={14} className="text-[var(--color-ink-muted)]" aria-hidden="true" />
            <span className="text-[var(--color-ink-muted)]">{label}</span>
            <span className="font-semibold">{n}</span>
          </span>
        ))}
      </div>

      {snapshot.stale && <p className="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm" role="alert">{t("stale")}</p>}
      {snapshot.agents.length === 0 && <p className="panel p-6 text-center text-sm text-[var(--color-ink-muted)]">{t("no-agents")}</p>}
      {error && <p className="status-error p-3" role="alert">{error}</p>}

      {!data && loading && (
        <p className="text-sm text-[var(--color-ink-muted)] flex items-center gap-2" role="status">
          <RefreshCw className="animate-spin" size={16} />{t("loading")}
        </p>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionPanel icon={Monitor} title={t("os")} value={data.os} empty={t("no-data")} columnsKey="os" />
          <SectionPanel icon={Cpu} title={t("hardware")} value={data.hardware} empty={t("no-data")} columnsKey="hardware" />
          <SectionPanel icon={Package} title={t("packages")} value={data.packages} empty={t("no-data")} columnsKey="packages" />
          <SectionPanel icon={Activity} title={t("processes")} value={data.processes} empty={t("no-data")} columnsKey="processes" />
          <SectionPanel icon={Network} title={t("ports")} value={data.ports} empty={t("no-data")} columnsKey="ports" />
          <SectionPanel icon={Server} title={t("services")} value={data.services} empty={t("no-data")} columnsKey="services" />
        </div>
      )}
    </section>
  );
}
