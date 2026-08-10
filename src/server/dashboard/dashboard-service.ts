import "server-only";

import { count, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Database } from "../db/types";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { getAgentSnapshot } from "../wazuh/agent-service";
import type { WazuhClient, WazuhConfig } from "../wazuh/types";
import { pingIndexer } from "../wazuh/indexer";

export type WazuhConnectionStatus = "connected" | "disconnected";

export interface DashboardSummary {
  health: {
    status: "ok" | "degraded" | "down";
    stale: boolean;
    syncedAt: Date;
    upstreamErrorCode: string | null;
    connectionStatus: WazuhConnectionStatus;
    reason: string;
    indexerStatus: WazuhConnectionStatus;
    indexerReason: string;
  };
  agentStatus: Record<string, number>;
  alertSeverity: Record<string, number>;
  workflows: Record<string, number>;
}

export async function getDashboardSummary(
  db: Database,
  actor: ActorContext,
  dependencies: { wazuh?: WazuhClient; wazuhConfig?: WazuhConfig; now?: Date } = {},
): Promise<DashboardSummary> {
  requirePermission(actor.permissions, "dashboard.read");
  const now = dependencies.now ?? new Date();
  const snapshot = dependencies.wazuh
    ? await getAgentSnapshot(db, dependencies.wazuh, now)
    : { agents: [], syncedAt: now, stale: false, upstreamErrorCode: null };

  const severityRows = await db
    .select({ level: schema.alerts.level, total: count() })
    .from(schema.alerts)
    .where(eq(schema.alerts.status, "open"))
    .groupBy(schema.alerts.level);
  const workflowRows = await db
    .select({ status: schema.alerts.status, total: count() })
    .from(schema.alerts)
    .groupBy(schema.alerts.status);

  const agentStatus = snapshot.agents.reduce<Record<string, number>>((counts, agent) => {
    counts[agent.status] = (counts[agent.status] ?? 0) + 1;
    return counts;
  }, {});
  const connectionStatus: WazuhConnectionStatus = snapshot.stale ? "disconnected" : "connected";
  const reason = snapshot.stale ? "Wazuh API unavailable" : "Wazuh API reachable";

  let indexerStatus: WazuhConnectionStatus = "connected";
  let indexerReason = "Indexer reachable";
  if (dependencies.wazuhConfig) {
    if (!dependencies.wazuhConfig.indexer) {
      indexerStatus = "disconnected";
      indexerReason = "Indexer not configured";
    } else {
      const ok = await pingIndexer(dependencies.wazuhConfig).catch(() => false);
      indexerStatus = ok ? "connected" : "disconnected";
      indexerReason = ok ? "Indexer reachable" : "Indexer unreachable";
    }
  }

  const alertSeverity = Object.fromEntries(severityRows.map((row) => [String(row.level), Number(row.total)]));
  const workflows = Object.fromEntries(workflowRows.map((row) => [row.status, Number(row.total)]));

  return {
    health: {
      status: snapshot.stale ? "down" : "ok",
      stale: snapshot.stale,
      syncedAt: snapshot.syncedAt,
      upstreamErrorCode: snapshot.upstreamErrorCode,
      connectionStatus,
      reason,
      indexerStatus,
      indexerReason,
    },
    agentStatus,
    alertSeverity,
    workflows,
  };
}
