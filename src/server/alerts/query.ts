import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { resolvePermissions } from "../authorization/resolve";
import type { Role } from "../authorization/permissions";
import type { AlertGroupPage, AlertGroupRow, AlertListQuery, AlertPage, AlertRecord, AlertStatus } from "./types";
import { DEFAULT_GROUP_WINDOW_MINUTES } from "./types";

export type { AlertListQuery, AlertPage };

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

export async function listAlerts(
  db: Database,
  actor: ActorContext,
  query: AlertListQuery = {},
): Promise<AlertPage> {
  requirePermission(actor.permissions, "alerts.list");

  const limit = validateLimit(query.limit);
  const cursor = parseCursor(query.cursor);

  const baseWhere = buildWhereClause(query);

  const items = await db
    .select({
      id: schema.alerts.id,
      wazuhEventId: schema.alerts.wazuhEventId,
      fingerprint: schema.alerts.fingerprint,
      wazuhTimestamp: schema.alerts.wazuhTimestamp,
      ingestedAt: schema.alerts.ingestedAt,
      agentId: schema.alerts.agentId,
      agentName: schema.alerts.agentName,
      agentIp: schema.alerts.agentIp,
      ruleId: schema.alerts.ruleId,
      ruleDescription: schema.alerts.ruleDescription,
      level: schema.alerts.level,
      groups: schema.alerts.groups,
      compliance: schema.alerts.compliance,
      status: schema.alerts.status,
      acknowledgedAt: schema.alerts.acknowledgedAt,
      acknowledgedByUserId: schema.alerts.acknowledgedByUserId,
      resolvedAt: schema.alerts.resolvedAt,
      resolvedByUserId: schema.alerts.resolvedByUserId,
      rawPayload: schema.alerts.rawPayload,
    })
    .from(schema.alerts)
    .where((eb) => {
      const conditions: import("drizzle-orm").SQL[] = [];

      if (baseWhere) {
        conditions.push(baseWhere);
      }

      if (cursor) {
        conditions.push(
          sql`${schema.alerts.ingestedAt} < ${cursor.ingestedAt} OR (${schema.alerts.ingestedAt} = ${cursor.ingestedAt} AND ${schema.alerts.id} < ${cursor.id})`,
        );
      }

      return conditions.length === 0 ? undefined : and(...conditions);
    })
    .orderBy(desc(schema.alerts.ingestedAt), desc(schema.alerts.id))
    .limit(limit + 1)
    .execute();

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, -1) : items;

  const nextCursor = hasMore && sliced.length > 0
    ? encodeCursor(sliced[sliced.length - 1].ingestedAt, sliced[sliced.length - 1].id)
    : null;

  const tagsByAgent = await fetchAgentTags(db, sliced.map((row) => row.agentId));

  return {
    items: sliced.map((row) => mapRow(row, tagsByAgent)),
    cursor: nextCursor,
    hasNext: hasMore,
  };
}

function validateLimit(input?: number): number {
  if (input === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(input) || input < MIN_LIMIT || input > MAX_LIMIT) {
    throw new Error(`limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`);
  }
  return input;
}

function encodeCursor(ingestedAt: Date, id: string): string {
  return `${ingestedAt.toISOString()}:${id}`;
}

function parseCursor(cursor?: string): { ingestedAt: Date; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.lastIndexOf(":");
  if (sep === -1) return null;
  const iso = cursor.slice(0, sep);
  const id = cursor.slice(sep + 1);
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return { ingestedAt: date, id };
}

function buildWhereClause(query: AlertListQuery): import("drizzle-orm").SQL | undefined {
  const clauses: import("drizzle-orm").SQL[] = [];

  if (query.status) {
    clauses.push(eq(schema.alerts.status, query.status as AlertStatus));
  }
  if (query.agentId) {
    clauses.push(eq(schema.alerts.agentId, query.agentId));
  }
  if (query.agentIds?.length) {
    clauses.push(inArray(schema.alerts.agentId, query.agentIds));
  }
  if (query.tags?.length) {
    clauses.push(
      sql`EXISTS (
        SELECT 1 FROM ${schema.agentTags}
        WHERE ${schema.agentTags.agentId} = ${schema.alerts.agentId}
          AND ${schema.agentTags.tag} IN (${sql.join(query.tags.map((tag) => sql`${tag}`), sql`, `)})
      )`,
    );
  }
  if (query.groups?.length) {
    clauses.push(sql`${schema.alerts.groups} && ARRAY[${sql.join(query.groups.map((group) => sql`${group}`), sql`, `)}]::text[]`);
  }
  if (query.ruleId) {
    clauses.push(eq(schema.alerts.ruleId, query.ruleId));
  }
  if (query.levelMin !== undefined) {
    clauses.push(gte(schema.alerts.level, query.levelMin));
  }
  if (query.levelMax !== undefined) {
    clauses.push(lte(schema.alerts.level, query.levelMax));
  }
  if (query.since) {
    clauses.push(gte(schema.alerts.wazuhTimestamp, query.since));
  }
  if (query.until) {
    clauses.push(lte(schema.alerts.wazuhTimestamp, query.until));
  }
  if (query.search) {
    clauses.push(
      or(
        ilike(schema.alerts.ruleDescription, `%${query.search}%`),
        ilike(schema.alerts.agentName, `%${query.search}%`),
        ilike(schema.alerts.agentId, `%${query.search}%`),
        ilike(schema.alerts.ruleId, `%${query.search}%`),
      ) as import("drizzle-orm").SQL<unknown>,
    );
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return and(...clauses) as import("drizzle-orm").SQL<unknown>;
}

function mapRow(
  row: {
    id: string;
    wazuhEventId: string | null;
    fingerprint: string;
    wazuhTimestamp: Date;
    ingestedAt: Date;
    agentId: string | null;
    agentName: string | null;
    agentIp: string | null;
    ruleId: string | null;
    ruleDescription: string;
    level: number;
    groups: string[];
    compliance: unknown;
    status: AlertStatus;
    acknowledgedAt: Date | null;
    acknowledgedByUserId: string | null;
    resolvedAt: Date | null;
    resolvedByUserId: string | null;
    rawPayload: unknown;
  },
  tagsByAgent?: Map<string, string[]>,
): AlertRecord {
  return {
    id: row.id,
    wazuhEventId: row.wazuhEventId,
    fingerprint: row.fingerprint,
    wazuhTimestamp: row.wazuhTimestamp,
    ingestedAt: row.ingestedAt,
    agentId: row.agentId,
    agentName: row.agentName,
    agentIp: row.agentIp,
    ruleId: row.ruleId,
    ruleDescription: row.ruleDescription,
    level: row.level,
    groups: row.groups,
    tags: row.agentId ? (tagsByAgent?.get(row.agentId) ?? []) : [],
    compliance: (row.compliance as Record<string, unknown>) ?? {},
    status: row.status,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedByUserId: row.acknowledgedByUserId,
    resolvedAt: row.resolvedAt,
    resolvedByUserId: row.resolvedByUserId,
    rawPayload: row.rawPayload,
  };
}

async function fetchAgentTags(
  db: Database,
  agentIds: (string | null | undefined)[],
): Promise<Map<string, string[]>> {
  const validIds = [...new Set(agentIds.filter((id): id is string => id != null))];
  if (validIds.length === 0) return new Map();
  const rows = await db
    .select({ agentId: schema.agentTags.agentId, tag: schema.agentTags.tag })
    .from(schema.agentTags)
    .where(inArray(schema.agentTags.agentId, validIds));
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const tags = map.get(row.agentId);
    if (tags) tags.push(row.tag);
    else map.set(row.agentId, [row.tag]);
  }
  return map;
}

export async function getAlertDetail(
  db: Database,
  actor: ActorContext,
  alertId: string,
): Promise<import("./types").AlertDetail> {
  requirePermission(actor.permissions, "alerts.details");
  const [alert] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId)).limit(1);
  if (!alert) throw new Error(`alert not found: ${alertId}`);
  const [timeline, tagsByAgent] = await Promise.all([
    db.select().from(schema.alertEvents)
      .where(eq(schema.alertEvents.alertId, alertId)).orderBy(asc(schema.alertEvents.occurredAt)),
    fetchAgentTags(db, [alert.agentId]),
  ]);
  return {
    ...mapRow(alert, tagsByAgent),
    timeline: timeline.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus as AlertStatus | null,
      toStatus: event.toStatus as AlertStatus,
      actorUserId: event.actorUserId,
      occurredAt: event.occurredAt,
      metadata: event.metadata as Record<string, unknown>,
    })),
  };
}

export async function listAlertGroups(
  db: Database,
  actor: ActorContext,
  query: AlertListQuery = {},
): Promise<AlertGroupPage> {
  requirePermission(actor.permissions, "alerts.list");

  const limit = validateLimit(query.limit);
  const cursor = parseCursor(query.cursor);
  const windowMinutes = query.windowMinutes ?? DEFAULT_GROUP_WINDOW_MINUTES;
  const baseWhere = buildWhereClause(query);

  // Gap-and-islands: alerts sharing (agent_id, rule_id, level) collapse into one
  // group only while consecutive occurrences stay within `windowMinutes`. A long
  // silence starts a fresh group. Incident linkage is aggregated per island.
  // ponytail: groups can split across cursor boundary; acceptable for triage.
  // Upgrade path: keyset paginate on the island key instead of rep_ingested_at.
  const windowInterval = sql`make_interval(mins => ${windowMinutes})`;

  const rows = await db.execute(sql`
    WITH filtered AS (
      SELECT
        id, agent_id, agent_name, rule_id, level,
        rule_description, status, wazuh_timestamp, ingested_at
      FROM ${schema.alerts}
      WHERE ${baseWhere ?? sql`TRUE`}
    ),
    gaped AS (
      SELECT
        f.*,
        COALESCE(
          (f.wazuh_timestamp - LAG(f.wazuh_timestamp) OVER w) > ${windowInterval},
          true
        ) AS is_break
      FROM filtered f
      WINDOW w AS (
        PARTITION BY f.agent_id, f.rule_id, f.level
        ORDER BY f.wazuh_timestamp
      )
    ),
    islanded AS (
      SELECT
        g.*,
        SUM(CASE WHEN g.is_break THEN 1 ELSE 0 END) OVER (
          PARTITION BY g.agent_id, g.rule_id, g.level
          ORDER BY g.wazuh_timestamp
          ROWS UNBOUNDED PRECEDING
        ) AS island_num
      FROM gaped g
    ),
    islands AS (
      SELECT
        agent_id, rule_id, level, island_num,
        MIN(wazuh_timestamp) AS first_seen,
        MAX(wazuh_timestamp) AS last_seen,
        MAX(ingested_at) AS rep_ingested_at,
        MAX(agent_name) AS agent_name,
        COUNT(*) AS group_count
      FROM islanded
      GROUP BY agent_id, rule_id, level, island_num
    ),
    reps AS (
      SELECT DISTINCT ON (agent_id, rule_id, level, island_num)
        agent_id, rule_id, level, island_num,
        id AS representative_id,
        rule_description AS rep_desc,
        status AS rep_status
      FROM islanded
      ORDER BY agent_id, rule_id, level, island_num, ingested_at DESC, wazuh_timestamp DESC
    ),
    inc_link AS (
      SELECT
        i.agent_id, i.rule_id, i.level, i.island_num,
        COUNT(DISTINCT ia.incident_id) AS incident_count,
        MIN(inc.id::text) FILTER (WHERE inc.status <> 'resolved') AS open_incident_id
      FROM islanded i
      JOIN ${schema.incidentAlerts} ia ON ia.alert_id = i.id
      LEFT JOIN ${schema.incidents} inc ON inc.id = ia.incident_id
      GROUP BY i.agent_id, i.rule_id, i.level, i.island_num
    )
    SELECT
      isl.agent_id, isl.rule_id, isl.level,
      isl.first_seen, isl.last_seen, isl.group_count,
      isl.rep_ingested_at, isl.agent_name,
      r.representative_id, r.rep_desc AS rule_description, r.rep_status,
      COALESCE(lk.incident_count, 0) AS incident_count,
      lk.open_incident_id
    FROM islands isl
    JOIN reps r
      ON r.agent_id = isl.agent_id
     AND r.rule_id = isl.rule_id
     AND r.level = isl.level
     AND r.island_num = isl.island_num
    LEFT JOIN inc_link lk
      ON lk.agent_id = isl.agent_id
     AND lk.rule_id = isl.rule_id
     AND lk.level = isl.level
     AND lk.island_num = isl.island_num
    ${cursor ? sql`WHERE isl.rep_ingested_at < ${cursor.ingestedAt}
                   OR (isl.rep_ingested_at = ${cursor.ingestedAt}
                       AND r.representative_id < ${cursor.id})` : sql``}
    ORDER BY isl.rep_ingested_at DESC, r.representative_id DESC
    LIMIT ${limit + 1}
  `);

  // Drizzle's node-postgres db.execute() returns { rows: [...] }.
  const raw = (rows as unknown as { rows: Array<{
    agent_id: string | null;
    agent_name: string | null;
    rule_id: string | null;
    level: number;
    first_seen: string | Date;
    last_seen: string | Date;
    rep_ingested_at: string | Date;
    group_count: number;
    representative_id: string;
    rule_description: string;
    rep_status: AlertStatus;
    incident_count: number;
    open_incident_id: string | null;
  }> }).rows;

  const hasMore = raw.length > limit;
  const sliced = hasMore ? raw.slice(0, -1) : raw;

  const nextCursor = hasMore && sliced.length > 0
    ? encodeCursor(new Date(sliced[sliced.length - 1].rep_ingested_at), sliced[sliced.length - 1].representative_id)
    : null;

  const groups: AlertGroupRow[] = sliced.map((row) => ({
    key: `${row.agent_id ?? ""}:${row.rule_id ?? ""}:${row.level}:${row.representative_id}`,
    count: Number(row.group_count),
    firstSeen: new Date(row.first_seen),
    lastSeen: new Date(row.last_seen),
    level: row.level,
    agentId: row.agent_id,
    agentName: row.agent_name,
    ruleId: row.rule_id,
    ruleDescription: row.rule_description,
    status: row.rep_status,
    representativeAlertId: row.representative_id,
    incidentCount: Number(row.incident_count),
    openIncidentId: row.open_incident_id ?? null,
  }));

  return {
    groups,
    cursor: nextCursor,
    hasNext: hasMore,
  };
}

export function makeActor(userId: string, role: Role = "admin"): import("../authorization/permissions").ActorContext {
  return {
    userId,
    role,
    permissions: new Set(resolvePermissions({ role })),
  };
}
