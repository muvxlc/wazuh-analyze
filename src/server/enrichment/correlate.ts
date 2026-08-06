import "server-only";

import { and, between, desc, eq, ne } from "drizzle-orm";

import type { Database } from "../db/types";
import type { alerts } from "../db/schema";
import { alerts as alertsTable } from "../db/schema";

export interface CorrelateInput {
  alertId: string;
  agentId: string | null;
  ruleId: string | null;
  wazuhTimestamp: Date;
  /** Window radius in minutes (default 30). */
  windowMinutes?: number;
  /** Max results (default 10). */
  limit?: number;
}

export interface RelatedAlert {
  id: string;
  ruleId: string | null;
  ruleDescription: string;
  level: number;
  agentId: string | null;
  agentName: string | null;
  wazuhTimestamp: Date;
  groups: string[];
}

/**
 * Finds related alerts using existing indexes (alerts_agent_idx, alerts_rule_idx,
 * alerts_wazuh_timestamp_idx). Scope: same agent OR same rule, within the time
 * window around the trigger alert.
 *
 * ponytail: cross-host srcip clustering via a generated `srcip_hash` column + index
 * to correlate attacks moving laterally across agents.
 */
export async function findRelatedAlerts(
  db: Database,
  input: CorrelateInput,
): Promise<RelatedAlert[]> {
  const { alertId, agentId, ruleId, wazuhTimestamp, windowMinutes, limit } = input;
  if (!agentId && !ruleId) return [];

  const windowMs = (windowMinutes ?? 30) * 60_000;
  const start = new Date(wazuhTimestamp.getTime() - windowMs);
  const end = new Date(wazuhTimestamp.getTime() + windowMs);

  const scopeCondition =
    agentId && ruleId
      ? and(eq(alertsTable.agentId, agentId), eq(alertsTable.ruleId, ruleId))
      : agentId
        ? eq(alertsTable.agentId, agentId)
        : eq(alertsTable.ruleId, ruleId!);

  const rows = await db
    .select({
      id: alertsTable.id,
      ruleId: alertsTable.ruleId,
      ruleDescription: alertsTable.ruleDescription,
      level: alertsTable.level,
      agentId: alertsTable.agentId,
      agentName: alertsTable.agentName,
      wazuhTimestamp: alertsTable.wazuhTimestamp,
      groups: alertsTable.groups,
    })
    .from(alertsTable)
    .where(and(ne(alertsTable.id, alertId), between(alertsTable.wazuhTimestamp, start, end), scopeCondition))
    .orderBy(desc(alertsTable.wazuhTimestamp))
    .limit(limit ?? 10);

  return rows.map((r) => ({
    ...r,
    groups: r.groups ?? [],
  })) satisfies RelatedAlert[];
}

export type { alerts };
