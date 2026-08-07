"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface QueueDetail {
  name: string;
  deferredCount: number;
  queuedCount: number;
  readyCount: number;
  activeCount: number;
  failedCount: number;
  totalCount: number;
}

interface QueuesData {
  queues: Record<string, QueueDetail>;
}

export function QueuesClient() {
  const t = useTranslations("queues");
  const [queues, setQueues] = useState<QueuesData["queues"]>({});
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = async () => {
    try {
      const res = await fetch("/api/queues");
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { data: QueuesData };
      setQueues(body.data.queues);
      setLastUpdated(new Date());
      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll();
    intervalRef.current = setInterval(() => { void poll(); }, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]">{t("title")}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">{t("subtitle")}</p>
        </div>
        {lastUpdated && (
          <p className="text-xs text-[var(--color-ink-muted)]" aria-live="polite">
            {t("lastUpdated")}: {lastUpdated.toLocaleTimeString()}
          </p>
        )}
      </header>

      {status === "loading" && (
        <p className="text-sm text-[var(--color-ink-muted)]" role="status">{t("loading")}</p>
      )}

      {status === "error" && (
        <p className="text-sm text-[var(--color-danger-ink)]" role="alert">{t("error")}</p>
      )}

      {status === "success" && Object.keys(queues).length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]" role="status">No queues registered.</p>
      )}

      {status === "success" && Object.keys(queues).length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(queues).map(([name, q]) => (
            <section
              key={name}
              className="rounded-[8px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-5"
              aria-label={`Queue: ${name}`}
            >
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">{name}</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[var(--color-ink-muted)]">{t("ready")}</dt>
                  <dd className="font-mono font-medium">{q.readyCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--color-ink-muted)]">{t("active")}</dt>
                  <dd className="font-mono font-medium">{q.activeCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--color-ink-muted)]">{t("failed")}</dt>
                  <dd className={`font-mono font-medium ${q.failedCount > 0 ? "text-[var(--color-danger-ink)]" : ""}`}>{q.failedCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--color-ink-muted)]">{t("deferred")}</dt>
                  <dd className="font-mono font-medium">{q.deferredCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--color-ink-muted)]">{t("total")}</dt>
                  <dd className="font-mono font-medium">{q.totalCount}</dd>
                </div>
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
