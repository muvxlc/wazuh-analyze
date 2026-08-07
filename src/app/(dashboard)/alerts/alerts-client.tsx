"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertFilters } from "../../../components/alerts/alert-filters";
import { AlertTable } from "../../../components/alerts/alert-table";
import { AlertDrawer } from "../../../components/alerts/alert-drawer";
import { UndoToast } from "../../../components/alerts/undo-toast";
import { AlertTagFilters } from "../../../components/alerts/alert-tag-filters";
import type { AlertRecord, AlertDetail } from "../../../server/alerts/types";

type TransitionTarget = "acknowledged" | "resolved" | "open";

interface UndoState {
  readonly message: string;
  readonly alertId: string;
  readonly undoTo: TransitionTarget | null;
}

export function AlertsClient({ canModify, canAnalyze }: { readonly canModify: boolean; readonly canAnalyze: boolean }) {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string | undefined>>({ levelMin: "4" });
  const [hideLow, setHideLow] = useState(true);
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  const [detailAlert, setDetailAlert] = useState<AlertDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Memoize group selection so AlertFilters stays in a stable controlled path
  // and does not re-mount its ChecklistPopover on unrelated re-renders.
  const selectedGroups = useMemo(() => {
    const g = filters.groups;
    return g ? g.split(",").filter(Boolean) : [];
  }, [filters.groups]);

  const load = useCallback(
    async (nextFilters = filters, nextCursor: string | null = null) => {
      setStatus("loading");
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(nextFilters)) {
        if (value) params.set(key, value);
      }
      if (selectedTags.length > 0) {
        params.set("tags", selectedTags.join(","));
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
    [filters, selectedTags]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/alerts/groups")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: { groups?: string[] } } | null) => {
        if (!cancelled && body?.data?.groups) setGroupOptions(body.data.groups);
      })
      .catch(() => {
        // ignore — group filter just has no options
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const transition = async (id: string, to: TransitionTarget) => {
    const response = await fetch(`/api/alerts/${id}/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: window.location.origin,
      },
      body: JSON.stringify({ to }),
    });
    if (!response.ok) throw new Error(`transition failed: ${response.status}`);
    await load();
  };

  const transitionWithUndo = async (id: string, to: TransitionTarget) => {
    const prevStatus = alerts.find((a) => a.id === id)?.status;
    if (!prevStatus) return;
    try {
      await transition(id, to);
      setUndoState({ message: `Alert transitioned to ${to}. Undo?`, alertId: id, undoTo: prevStatus as TransitionTarget });
    } catch {
      setUndoState({ message: `Transition to ${to} failed.`, alertId: id, undoTo: null });
    }
  };

  const handleUndo = async () => {
    if (!undoState?.undoTo) return;
    try {
      await transition(undoState.alertId, undoState.undoTo);
    } catch {
      // If rollback fails, the toast simply stays until dismissed.
    }
    setUndoState(null);
  };

  const dismissUndo = () => setUndoState(null);

  const openDetail = async (alert: AlertRecord) => {
    try {
      const res = await fetch(`/api/alerts/${alert.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { data: AlertDetail };
      setDetailAlert(data.data);
      setDrawerOpen(true);
    } catch {
      // ignore — drawer stays closed
    }
  };

  return (
    <section className="page-section">
      <h1>Alerts</h1>
      <AlertTagFilters
        initialTags={selectedTags}
        onChange={(tags) => setSelectedTags(tags)}
      />
      <AlertFilters
        groupOptions={groupOptions}
        selectedGroups={selectedGroups}
        onGroupsChange={(groups) => {
          const next = { ...filters, groups: groups.length ? groups.join(",") : undefined };
          setFilters(next);
          void load(next);
        }}
        hideLow={hideLow}
        onToggleHideLow={(hide) => {
          setHideLow(hide);
          setFilters((prev) => ({ ...prev, levelMin: hide ? "4" : undefined }));
          void load({ ...filters, levelMin: hide ? "4" : undefined });
        }}
        onChange={(next) => {
          setFilters(next);
          void load(next);
        }}
      />
      <AlertTable
        status={status}
        alerts={alerts}
        canModify={canModify}
        onAcknowledge={(id) => void transitionWithUndo(id, "acknowledged")}
        onResolve={(id) => void transitionWithUndo(id, "resolved")}
        onReopen={(id) => void transitionWithUndo(id, "open")}
        onOpenDetail={openDetail}
      />
      {cursor && (
        <button type="button" onClick={() => void load(filters, cursor)}>
          Next page
        </button>
      )}
      <AlertDrawer
        alert={detailAlert}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        canAnalyze={canAnalyze}
      />
      {undoState && (
        <UndoToast
          message={undoState.message}
          onUndo={() => void handleUndo()}
          onClose={dismissUndo}
        />
      )}
    </section>
  );
}
