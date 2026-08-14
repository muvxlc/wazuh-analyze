"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface SourceEntry {
  id: string;
  sourceKey: string;
  sourceType: string;
  endpoint: string | null;
  credentialScope: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastEventAt: string | null;
  itemCount: number | null;
  parseErrorCount: number;
  freshnessSlaMs: number | null;
  contractVersion: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface DeadLetterRow {
  id: string;
  source: string;
  text: string;
  errorReason: string;
  status: string;
  retriedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface ReplayResult {
  attempted?: number;
  inserted?: number;
  duplicates?: number;
  deadLettersInserted?: number;
}

interface Props {
  canManage: boolean;
}

function isStale(s: SourceEntry): boolean {
  return s.enabled && s.freshnessSlaMs != null && (s.lastSuccessAt == null || Date.now() - new Date(s.lastSuccessAt).getTime() > s.freshnessSlaMs);
}

export function SourceCoverageClient({ canManage }: Props) {
  const t = useTranslations("sourceCoverage");
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [deadLetters, setDeadLetters] = useState<DeadLetterRow[]>([]);
  const [staleOnly, setStaleOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<{ attempted?: number; inserted?: number; duplicates?: number; deadLettersInserted?: number } | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [editingSla, setEditingSla] = useState<string | null>(null);
  const [slaDraft, setSlaDraft] = useState("");
  const [slaError, setSlaError] = useState<string | null>(null);
  const [slaSaving, setSlaSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    const params = new URLSearchParams();
    if (staleOnly) params.set("staleOnly", "true");
    try {
      const [srcRes, dlRes] = await Promise.all([
        fetch(`/api/source-coverage?${params.toString()}`),
        fetch("/api/dead-letter?status=open&limit=20"),
      ]);
      if (!srcRes.ok || !dlRes.ok) throw new Error("fetch failed");
      setSources(await srcRes.json().then((r) => r.data));
      setDeadLetters(await dlRes.json().then((r) => r.data.items));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [staleOnly]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  const toggleEnabled = async (source: SourceEntry) => {
    try {
      const res = await fetch(`/api/source-coverage/${encodeURIComponent(source.sourceKey)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      if (res.ok) {
        setSources((prev) => prev.map((s) => (s.sourceKey === source.sourceKey ? { ...s, enabled: !s.enabled } : s)));
      } else {
        setError(t("fetch-error"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const retryDeadLetter = async (id: string) => {
    setRetryMsg(null);
    const res = await fetch(`/api/dead-letter/${id}/retry`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setRetryMsg(body?.error?.code === "dead_letter_not_retryable" ? t("retry-claimed") : t("retry-failed"));
      return;
    }
    const { data } = await res.json();
    setRetryMsg(data.status === "retried" || data.status === "duplicate" ? t("retry-success") : t("retry-failed"));
    fetchAll();
  };

  const handleReplay = async () => {
    setReplayResult(null);
    setReplayError(null);
    setReplaying(true);
    try {
      const res = await fetch("/api/ingestion/replay", { method: "POST" });
      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        const ms = body?.error?.retryAfterMs ?? body?.retryAfterMs ?? 60000;
        setReplayError(t("replay-gate", { ms }));
        return;
      }
      if (!res.ok) {
        setReplayError(t("replay-error"));
        return;
      }
      const { data } = await res.json();
      setReplayResult(data as ReplayResult);
    } catch (e) {
      setReplayError(e instanceof Error ? e.message : t("replay-error"));
    } finally {
      setReplaying(false);
    }
  };

  const startEditSla = (s: SourceEntry) => {
    setEditingSla(s.id);
    setSlaDraft(s.freshnessSlaMs != null ? String(Math.round(s.freshnessSlaMs / 60000)) : "");
    setSlaError(null);
  };

  const cancelEditSla = () => {
    setEditingSla(null);
    setSlaDraft("");
    setSlaError(null);
  };

  const saveSla = async (s: SourceEntry, draft: string) => {
    const mins = parseInt(draft, 10);
    if (isNaN(mins) || mins < 0 || mins > 1440) {
      setSlaError(t("sla-invalid"));
      return;
    }
    setSlaSaving(true);
    try {
      const res = await fetch(`/api/source-coverage/${encodeURIComponent(s.sourceKey)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ freshnessSlaMs: mins * 60000 }),
      });
      if (!res.ok) {
        setSlaError(t("sla-error"));
        return;
      }
      const updated = await res.json().then((r) => r.data as SourceEntry);
      setSources((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
      setEditingSla(null);
      setSlaDraft("");
      setSlaError(null);
    } catch (e) {
      setSlaError(e instanceof Error ? e.message : t("sla-error"));
    } finally {
      setSlaSaving(false);
    }
  };

  const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <div className="flex items-center gap-3">
          {canManage && (
            <button
              type="button"
              onClick={() => void handleReplay()}
              disabled={replaying}
              className="outline-button px-3 py-1 text-sm disabled:opacity-50"
            >
              {replaying ? t("replay-running") : t("replay")}
            </button>
          )}
          {canManage && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} />
              {t("stale-only")}
            </label>
          )}
        </div>
      </div>

      {(replayError || replayResult) && (
        <div className="text-sm">
          {replayError && <p className="text-red-600">{replayError}</p>}
          {replayResult && (
            <p className="text-green-700">
              {t("replay-success")}{" "}
              {t("replay-result", {
                attempted: replayResult?.attempted ?? 0,
                inserted: replayResult?.inserted ?? 0,
                duplicates: replayResult?.duplicates ?? 0,
                deadLetters: replayResult?.deadLettersInserted ?? 0,
              })}
            </p>
          )}
        </div>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {retryMsg && <p className="text-sm text-[var(--color-ink-muted)]">{retryMsg}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("loading")}</p>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-ink-muted)]">
              <tr>
                <th className="py-2 pr-3">{t("source")}</th>
                <th className="py-2 pr-3">{t("type")}</th>
                <th className="py-2 pr-3">{t("status")}</th>
                <th className="py-2 pr-3">{t("last-success")}</th>
                <th className="py-2 pr-3">{t("last-event")}</th>
                <th className="py-2 pr-3">{t("items")}</th>
                <th className="py-2 pr-3">{t("errors")}</th>
                <th className="py-2 pr-3">{t("sla")}</th>
                <th className="py-2 pr-3">{t("last-error")}</th>
                {canManage && <th className="py-2 pr-3">{t("actions")}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {sources.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="py-2 pr-3 font-medium">{s.sourceKey}</td>
                  <td className="py-2 pr-3">{s.sourceType}</td>
                  <td className="py-2 pr-3">
                    {s.enabled
                      ? isStale(s)
                        ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">stale</span>
                        : <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">ok</span>
                      : <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">disabled</span>}
                  </td>
                  <td className="py-2 pr-3">{fmtTime(s.lastSuccessAt)}</td>
                  <td className="py-2 pr-3">{fmtTime(s.lastEventAt)}</td>
                  <td className="py-2 pr-3">{s.itemCount ?? "—"}</td>
                  <td className="py-2 pr-3">{s.parseErrorCount}</td>
                  <td className="py-2 pr-3">
                    {s.freshnessSlaMs != null ? (
                      editingSla === s.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={1440}
                            value={slaDraft}
                            onChange={(e) => setSlaDraft(e.target.value)}
                            className="w-16 border rounded px-1 py-0.5 text-xs"
                            autoFocus
                          />
                          <span className="text-xs text-[var(--color-ink-muted)]">{t("sla-minutes")}</span>
                          <button
                            type="button"
                            onClick={() => void saveSla(s, slaDraft)}
                            disabled={slaSaving}
                            className="text-xs underline text-green-700 disabled:opacity-50"
                          >
                            {t("sla-save")}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditSla}
                            className="text-xs underline text-[var(--color-ink-muted)]"
                          >
                            {t("sla-cancel")}
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span>{Math.round(s.freshnessSlaMs / 60000)}m</span>
                          <button
                            type="button"
                            onClick={() => startEditSla(s)}
                            className="text-[var(--color-ink-muted)] hover:text-ink"
                            title={t("sla-edit")}
                            aria-label={t("sla-edit")}
                          >
                            ✏️
                          </button>
                        </span>
                      )
                    ) : (
                      canManage ? (
                        <span className="inline-flex items-center gap-1">
                          <span>—</span>
                          <button
                            type="button"
                            onClick={() => startEditSla(s)}
                            className="text-[var(--color-ink-muted)] hover:text-ink"
                            title={t("sla-edit")}
                            aria-label={t("sla-edit")}
                          >
                            ✏️
                          </button>
                        </span>
                      ) : (
                        "—"
                      )
                    )}
                    {slaError && editingSla === s.id && <p className="text-red-600 text-xs mt-0.5">{slaError}</p>}
                  </td>
                  <td className="py-2 pr-3 max-w-[220px] truncate" title={s.lastError ?? undefined}>{s.lastError ?? "—"}</td>
                  {canManage && (
                    <td className="py-2 pr-3">
                      <button onClick={() => toggleEnabled(s)} className="text-xs underline">
                        {s.enabled ? t("disable") : t("enable")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {sources.length === 0 && (
                <tr><td colSpan={10} className="py-4 text-center text-sm text-[var(--color-ink-muted)]">{t("empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-2">{t("dlq-title")}</h2>
        {deadLetters.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("dlq-empty")}</p>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-ink-muted)]">
                <tr>
                  <th className="py-2 pr-3">{t("dlq-source")}</th>
                  <th className="py-2 pr-3">{t("dlq-text")}</th>
                  <th className="py-2 pr-3">{t("dlq-error")}</th>
                  <th className="py-2 pr-3">{t("dlq-created")}</th>
                  {canManage && <th className="py-2 pr-3">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {deadLetters.map((dl) => (
                  <tr key={dl.id} className="align-top">
                    <td className="py-2 pr-3 font-medium">{dl.source}</td>
                    <td className="py-2 pr-3 max-w-[260px] truncate" title={dl.text}>{dl.text}</td>
                    <td className="py-2 pr-3 max-w-[220px] truncate" title={dl.errorReason}>{dl.errorReason}</td>
                    <td className="py-2 pr-3">{fmtTime(dl.createdAt)}</td>
                    {canManage && (
                      <td className="py-2 pr-3">
                        <button onClick={() => retryDeadLetter(dl.id)} className="text-xs underline">
                          {t("dlq-retry")}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
