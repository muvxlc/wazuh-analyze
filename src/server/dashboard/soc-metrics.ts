import "server-only";

import { sql } from "drizzle-orm";

import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import type { Database } from "../db/types";

export type SocRange = "24h" | "7d" | "30d";

export interface SocMetrics {
  range: SocRange;
  /** Mean acknowledged-to-ingested latency in seconds (null when none acknowledged). */
  mttdSeconds: number | null;
  /** Mean resolved-to-ingested latency in seconds (null when none resolved). */
  mttrSeconds: number | null;
  /** Latest-verdict false-positive rate 0..1 (null when no analyzed alerts). */
  falsePositiveRate: number | null;
  /** Hourly alert buckets by level over the range. */
  alertsOverTime: Array<{ bucket: string; level: number; count: number }>;
  topAgents: Array<{ agentId: string | null; agentName: string | null; count: number }>;
  topRules: Array<{ ruleId: string | null; ruleDescription: string | null; count: number }>;
  topSourceIps: Array<{ sourceIp: string | null; count: number }>;
  mitreHeatmap: Array<{ tactic: string; count: number }>;
  threatIntelDistribution: Array<{ category: string; count: number }>;
  incidentBacklog: number;
}

const RANGE_INTERVALS: Record<SocRange, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export function parseSocRange(value: string | undefined): SocRange {
  return value === "7d" || value === "30d" ? value : "24h";
}

export async function getSocMetrics(
  db: Database,
  actor: ActorContext,
  range: SocRange,
): Promise<SocMetrics> {
  requirePermission(actor.permissions, "dashboard.read");

  const interval = RANGE_INTERVALS[range];

  const [mttd, mttr, falsePositive, alertsOverTime, topAgents, topRules, topSourceIps, mitre, threatIntel, backlog] =
    await Promise.all([
      // MTTD: mean seconds between ingest and acknowledge, over alerts acknowledged in-range.
      db.execute<{ avg_seconds: number | null }>(sql`
        SELECT EXTRACT(EPOCH FROM AVG(acknowledged_at - ingested_at))::float8 AS avg_seconds
        FROM alerts
        WHERE acknowledged_at IS NOT NULL
          AND acknowledged_at >= NOW() - (${interval})::interval
      `),
      // MTTR: mean seconds between ingest and resolve.
      db.execute<{ avg_seconds: number | null }>(sql`
        SELECT EXTRACT(EPOCH FROM AVG(resolved_at - ingested_at))::float8 AS avg_seconds
        FROM alerts
        WHERE resolved_at IS NOT NULL
          AND resolved_at >= NOW() - (${interval})::interval
      `),
      // False-positive rate: latest verdict per alert (distinct on).
      db.execute<{ analyzed: number; fp: number }>(sql`
        WITH latest AS (
          SELECT DISTINCT ON (alert_id) verdict
          FROM alert_analyses
          WHERE created_at >= NOW() - (${interval})::interval
          ORDER BY alert_id, created_at DESC
        )
        SELECT COUNT(*)::int AS analyzed,
               COUNT(*) FILTER (WHERE (verdict->>'likelyFalsePositive')::boolean) AS fp
        FROM latest
      `),
      // Alerts over time: hourly buckets by level.
      db.execute<{ bucket: string; level: number; count: number }>(sql`
        SELECT date_trunc('hour', wazuh_timestamp)::text AS bucket,
               level,
               COUNT(*)::int AS count
        FROM alerts
        WHERE wazuh_timestamp >= NOW() - (${interval})::interval
        GROUP BY bucket, level
        ORDER BY bucket ASC
      `),
      db.execute<{ agent_id: string | null; agent_name: string | null; count: number }>(sql`
        SELECT agent_id, agent_name, COUNT(*)::int AS count
        FROM alerts
        WHERE wazuh_timestamp >= NOW() - (${interval})::interval
        GROUP BY agent_id, agent_name
        ORDER BY count DESC
        LIMIT 5
      `),
      db.execute<{ rule_id: string | null; rule_description: string | null; count: number }>(sql`
        SELECT rule_id, rule_description, COUNT(*)::int AS count
        FROM alerts
        WHERE wazuh_timestamp >= NOW() - (${interval})::interval
        GROUP BY rule_id, rule_description
        ORDER BY count DESC
        LIMIT 5
      `),
      db.execute<{ source_ip: string | null; count: number }>(sql`
        SELECT (raw_payload->'data'->>'srcip') AS source_ip, COUNT(*)::int AS count
        FROM alerts
        WHERE wazuh_timestamp >= NOW() - (${interval})::interval
          AND raw_payload->'data'->>'srcip' IS NOT NULL
        GROUP BY source_ip
        ORDER BY count DESC
        LIMIT 5
      `),
      // MITRE heatmap: tactics from latest verdicts.
      db.execute<{ tactic: string; count: number }>(sql`
        WITH latest AS (
          SELECT DISTINCT ON (alert_id) verdict
          FROM alert_analyses
          WHERE created_at >= NOW() - (${interval})::interval
          ORDER BY alert_id, created_at DESC
        )
        SELECT m.elem->>'tactic' AS tactic, COUNT(*)::int AS count
        FROM latest, jsonb_array_elements(verdict->'mitreAttack') AS m(elem)
        WHERE m.elem->>'tactic' IS NOT NULL AND m.elem->>'tactic' <> ''
        GROUP BY tactic
        ORDER BY count DESC
      `),
      // Threat intel distribution: categories from latest ioc_lookups.
      db.execute<{ category: string; count: number }>(sql`
        WITH latest AS (
          SELECT DISTINCT ON (alert_id) ioc_lookups
          FROM alert_analyses
          WHERE created_at >= NOW() - (${interval})::interval
          ORDER BY alert_id, created_at DESC
        )
        SELECT COALESCE(ioc.elem->>'abuseCategory', 'unknown') AS category, COUNT(*)::int AS count
        FROM latest, jsonb_array_elements(ioc_lookups) AS ioc(elem)
        GROUP BY category
        ORDER BY count DESC
      `),
      db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count
        FROM incidents
        WHERE status IN ('open', 'investigating')
          AND created_at >= NOW() - (${interval})::interval
      `),
    ]);

  const analyzed = Number(falsePositive.rows[0]?.analyzed ?? 0);
  const fpCount = Number(falsePositive.rows[0]?.fp ?? 0);

  return {
    range,
    mttdSeconds: mttd.rows[0]?.avg_seconds ?? null,
    mttrSeconds: mttr.rows[0]?.avg_seconds ?? null,
    falsePositiveRate: analyzed > 0 ? fpCount / analyzed : null,
    alertsOverTime: alertsOverTime.rows.map((r) => ({
      bucket: r.bucket,
      level: Number(r.level),
      count: Number(r.count),
    })),
    topAgents: topAgents.rows.map((r) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      count: Number(r.count),
    })),
    topRules: topRules.rows.map((r) => ({
      ruleId: r.rule_id,
      ruleDescription: r.rule_description,
      count: Number(r.count),
    })),
    topSourceIps: topSourceIps.rows.map((r) => ({ sourceIp: r.source_ip, count: Number(r.count) })),
    mitreHeatmap: mitre.rows.map((r) => ({ tactic: r.tactic, count: Number(r.count) })),
    threatIntelDistribution: threatIntel.rows.map((r) => ({ category: r.category, count: Number(r.count) })),
    incidentBacklog: Number(backlog.rows[0]?.count ?? 0),
  };
}
