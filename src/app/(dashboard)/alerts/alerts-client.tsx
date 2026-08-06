"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertFilters } from "../../../components/alerts/alert-filters";
import { AlertTable } from "../../../components/alerts/alert-table";
import type { AlertRecord } from "../../../server/alerts/types";

export function AlertsClient({ canModify }: { readonly canModify: boolean }) {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});

  const load = useCallback(
    async (nextFilters = filters, nextCursor: string | null = null) => {
      setStatus("loading");
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(nextFilters)) {
        if (value) params.set(key, value);
      }
      if (nextCursor) params.set("cursor", nextCursor);
      try {
        const response = await fetch(`/api/alerts?${params}`);
        if (!response.ok) throw new Error();
        const body = (await response.json()) as {
          data: { items: AlertRecord[]; cursor: string | null };
        };
        setAlerts(body.data.items);
        setCursor(body.data.cursor);
        setStatus("success");
      } catch {
        setStatus("error");
      }
    },
    [filters]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const transition = async (id: string, to: "acknowledged" | "resolved") => {
    await fetch(`/api/alerts/${id}/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: window.location.origin,
      },
      body: JSON.stringify({ to }),
    });
    void load();
  };

  return (
    <section>
      <h1>Alerts</h1>
      <AlertFilters
        onChange={(next) => {
          setFilters(next);
          void load(next);
        }}
      />
      <AlertTable
        status={status}
        alerts={alerts}
        canModify={canModify}
        onAcknowledge={(id) => void transition(id, "acknowledged")}
        onResolve={(id) => void transition(id, "resolved")}
      />
      {cursor && (
        <button type="button" onClick={() => void load(filters, cursor)}>
          Next page
        </button>
      )}
    </section>
  );
}
