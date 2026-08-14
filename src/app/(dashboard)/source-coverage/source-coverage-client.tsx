"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ReplayControl } from "../../../components/source-coverage/replay-control";
import { SlaEditor } from "../../../components/source-coverage/sla-editor";

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

  const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <ReplayControl canManage={canManage} />
          {canManage && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} />
              {t("stale-only")}
            </label>
          )}
        </div>
      </div>

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
                    <SlaEditor
                      source={s}
                      canManage={canManage}
                      onSaved={(updated) =>
                        setSources((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
                      }
                    />
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
