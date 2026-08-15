"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface ReplayResult {
  attempted?: number;
  inserted?: number;
  duplicates?: number;
  deadLettersInserted?: number;
}

interface Props {
  readonly canManage: boolean;
}

export function ReplayControl({ canManage }: Props) {
  const t = useTranslations("sourceCoverage");
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

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

  return (
    <>
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
    </>
  );
}
