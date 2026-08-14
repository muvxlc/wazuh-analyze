"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertFilters } from "../../../components/alerts/alert-filters";
import { AlertTable } from "../../../components/alerts/alert-table";
import { AlertDrawer } from "../../../components/alerts/alert-drawer";
import { UndoToast } from "../../../components/ui/undo-toast";
import { AlertTagFilters } from "../../../components/alerts/alert-tag-filters";
import type { AlertRecord, AlertDetail, AlertGroupRow } from "../../../server/alerts/types";

type TransitionTarget = "acknowledged" | "resolved" | "open";

interface UndoState {
  readonly message: string;
  readonly alertId: string;
  readonly undoTo: TransitionTarget | null;
}

// API JSON returns timestamps as strings; normalize to Date at the boundary so
// downstream Date methods (.getTime(), .toISOString()) don't throw.
function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string | number);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function normalizeAlert<T extends object>(raw: T): Omit<T, "wazuhTimestamp" | "ingestedAt"> & { wazuhTimestamp: Date; ingestedAt: Date } {
  const { wazuhTimestamp, ingestedAt, ...rest } = raw as { wazuhTimestamp: unknown; ingestedAt: unknown } & T;
  return { ...rest, wazuhTimestamp: asDate(wazuhTimestamp), ingestedAt: asDate(ingestedAt) } as Omit<T, "wazuhTimestamp" | "ingestedAt"> & { wazuhTimestamp: Date; ingestedAt: Date };
}

function normalizeGroup<T extends object>(raw: T): Omit<T, "firstSeen" | "lastSeen"> & { firstSeen: Date; lastSeen: Date } {
  const { firstSeen, lastSeen, ...rest } = raw as { firstSeen: unknown; lastSeen: unknown } & T;
  return { ...rest, firstSeen: asDate(firstSeen), lastSeen: asDate(lastSeen) } as Omit<T, "firstSeen" | "lastSeen"> & { firstSeen: Date; lastSeen: Date };
}

export function AlertsClient({ canModify, canAnalyze }: { readonly canModify: boolean; readonly canAnalyze: boolean }) {
  const t = useTranslations("alerts");
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [groupRows, setGroupRows] = useState<AlertGroupRow[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [cursor, setCurs] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string | undefined>>({ levelMin: "4" });
  const [hideLow, setHideLow] = useState(true);
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  const [detailAlert, setDetailAlert] = useState<AlertDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Grouping toggle + expansion state + relative-time clock.
  const [grouped, setGrouped] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  const [groupMembers, setGroupMembers] = useState<Record<string, AlertRecord[]>>({});
  const [loadingGroupKey, setLoadingGroupKey] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const selectedGroups = useMemo(() => {
    const g = filters.groups;
    return g ? g.split(",").filter(Boolean) : [];
  }, [filters.groups]);

  const buildParams = useCallback(
    (nextFilters: Record<string, string | undefined>, nextCursor: string | null) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(nextFilters)) {
        if (value) params.set(key, value);
      }
      if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));
      if (grouped) params.set("group", "true");
      if (nextCursor) params.set("cursor", nextCursor);
      return params;
    },
    [selectedTags, grouped],
  );

  const load = useCallback(
    async (nextFilters = filters, nextCursor: string | null = null) => {
      setStatus("loading");
      const params = buildParams(nextFilters, nextCursor);
      try {
        const response = await fetch(`/api/alerts?${params}`);
        if (!response.ok) throw new Error();
        const body = (await response.json()) as {
          data:
            | { items: AlertRecord[]; cursor: string | null }
            | { groups: AlertGroupRow[]; cursor: string | null };
        };
        if ("items" in body.data) {
          setAlerts(body.data.items.map(normalizeAlert));
          setGroupRows([]);
        } else {
          setGroupRows(body.data.groups.map(normalizeGroup));
          setAlerts([]);
        }
        setCurs(body.data.cursor);
        setPage((current) => (nextCursor ? current + 1 : 1));
        setStatus("success");
      } catch {
        setStatus("error");
      }
    },
    [filters, buildParams],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Relative-time refresh: bump `now` every 60s so "5m ago" / NEW badge stay live.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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

  const toggleGroup = useCallback(
    async (key: string) => {
      const group = groupRows.find((g) => g.key === key);
      const isOpen = expandedKeys.has(key);
      const nextOpen = new Set(expandedKeys);
      if (isOpen) {
        nextOpen.delete(key);
        setExpandedKeys(nextOpen);
        return;
      }
      nextOpen.add(key);
      setExpandedKeys(nextOpen);
      if (group && !groupMembers[key]) {
        setLoadingGroupKey(key);
        try {
          const params = new URLSearchParams({
            agentId: group.agentId ?? "",
            ruleId: group.ruleId ?? "",
            level: String(group.level),
            since: group.firstSeen.toISOString(),
            until: group.lastSeen.toISOString(),
            limit: "100",
          });
          const res = await fetch(`/api/alerts/group-members?${params}`);
          if (res.ok) {
            const body = (await res.json()) as { data: { items: AlertRecord[] } };
            setGroupMembers((prev) => ({ ...prev, [key]: body.data.items.map(normalizeAlert) }));
          }
        } catch {
          // leave drawer closed on failure
        } finally {
          setLoadingGroupKey(null);
        }
      }
    },
    [groupRows, expandedKeys, groupMembers],
  );

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

  const toggleGrouping = () => {
    setExpandedKeys(new Set());
    setGroupMembers({});
    setGrouped((prev) => !prev);
  };

  return (
    <section className="page-section">
      <h1>Alerts</h1>
      <AlertTagFilters
        initialTags={selectedTags}
        onChange={(tags) => setSelectedTags(tags)}
      />
      <div className="alerts-toolbar">
        <label className="group-toggle">
          <input
            type="checkbox"
            checked={grouped}
            onChange={toggleGrouping}
          />
          Group duplicates
        </label>
      </div>
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
        now={now}
        canModify={canModify}
        onAcknowledge={(id) => void transitionWithUndo(id, "acknowledged")}
        onResolve={(id) => void transitionWithUndo(id, "resolved")}
        onReopen={(id) => void transitionWithUndo(id, "open")}
        onOpenDetail={openDetail}
        grouped={grouped}
        groups={groupRows}
        groupMembers={groupMembers}
        expandedKeys={expandedKeys}
        onToggleGroup={toggleGroup}
        loadingGroupKey={loadingGroupKey}
      />
      <div className="pagination flex items-center justify-between gap-3 text-sm text-[var(--color-ink-muted)]">
        <span>{t("page", { n: page })}</span>
        {cursor && (
          <button
            type="button"
            className="outline-button"
            disabled={status === "loading"}
            onClick={() => void load(filters, cursor)}
          >
            {t("next")}
          </button>
        )}
      </div>
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
