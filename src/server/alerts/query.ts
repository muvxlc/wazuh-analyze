import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { resolvePermissions } from "../authorization/resolve";
import type { Role } from "../authorization/permissions";
import type { AlertListQuery, AlertPage, AlertRecord, AlertStatus } from "./types";

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

  return {
    items: sliced.map(mapRow),
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
  if (query.ruleId) {
    clauses.push(eq(schema.alerts.ruleId, query.ruleId));
  }
  if (query.levelMin !== undefined) {
    clauses.push(gte(schema.alerts.level, query.levelMin));
  }
  if (query.levelMax !== undefined) {
    clauses.push(lte(schema.alerts.level, query.levelMax));
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

function mapRow(row: {
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
}): AlertRecord {
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
    compliance: (row.compliance as Record<string, unknown>) ?? {},
    status: row.status,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedByUserId: row.acknowledgedByUserId,
    resolvedAt: row.resolvedAt,
    resolvedByUserId: row.resolvedByUserId,
    rawPayload: row.rawPayload,
  };
}

export async function getAlertDetail(
  db: Database,
  actor: ActorContext,
  alertId: string,
): Promise<import("./types").AlertDetail> {
  requirePermission(actor.permissions, "alerts.details");
  const [alert] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId)).limit(1);
  if (!alert) throw new Error(`alert not found: ${alertId}`);
  const timeline = await db.select().from(schema.alertEvents)
    .where(eq(schema.alertEvents.alertId, alertId)).orderBy(asc(schema.alertEvents.occurredAt));
  return {
    ...mapRow(alert),
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

export function makeActor(userId: string, role: Role = "admin"): import("../authorization/permissions").ActorContext {
  return {
    userId,
    role,
    permissions: new Set(resolvePermissions({ role })),
  };
}
