import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";
import type { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { AppError } from "../errors";
import type { IncidentDetail, IncidentStatus } from "./types";

export interface IncidentListQuery {
  status?: IncidentStatus;
  agentId?: string;
  ruleId?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}

export interface IncidentListItem {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: string;
  agentId: string | null;
  ruleId: string | null;
  assigneeUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  alertCount: number;
}

export interface IncidentPage {
  items: IncidentListItem[];
  total: number;
}

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function validateLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
}

function validateOffset(offset?: number): number {
  if (offset === undefined) return 0;
  return Math.max(0, Math.trunc(offset));
}

export async function listIncidents(
  db: Database,
  actor: ActorContext,
  query: IncidentListQuery = {},
): Promise<IncidentPage> {
  requirePermission(actor.permissions, "incidents.list");

  const limit = validateLimit(query.limit);
  const offset = validateOffset(query.offset);

  const conditions = [];
  if (query.status) conditions.push(eq(schema.incidents.status, query.status));
  if (query.agentId) conditions.push(eq(schema.incidents.agentId, query.agentId));
  if (query.ruleId) conditions.push(eq(schema.incidents.ruleId, query.ruleId));
  if (query.severity) conditions.push(eq(schema.incidents.severity, query.severity));

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: schema.incidents.id,
      title: schema.incidents.title,
      status: schema.incidents.status,
      severity: schema.incidents.severity,
      agentId: schema.incidents.agentId,
      ruleId: schema.incidents.ruleId,
      assigneeUserId: schema.incidents.assigneeUserId,
      createdAt: schema.incidents.createdAt,
      updatedAt: schema.incidents.updatedAt,
      closedAt: schema.incidents.closedAt,
    })
    .from(schema.incidents)
    .where(where)
    .orderBy(desc(schema.incidents.createdAt))
    .limit(limit)
    .offset(offset);

  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db
        .select({
          incidentId: schema.incidentAlerts.incidentId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.incidentAlerts)
        .where(inArray(schema.incidentAlerts.incidentId, ids))
        .groupBy(schema.incidentAlerts.incidentId)
    : [];

  const countMap = new Map<string, number>();
  for (const c of counts) {
    countMap.set(c.incidentId, c.count);
  }

  const totalRows = await db
    .select({ value: schema.incidents.id })
    .from(schema.incidents)
    .where(where);

  return {
    items: rows.map((r) => ({
      ...r,
      status: r.status as IncidentStatus,
      alertCount: countMap.get(r.id) ?? 0,
    })),
    total: totalRows.length,
  };
}

export async function getIncidentDetail(
  db: Database,
  actor: ActorContext,
  incidentId: string,
): Promise<IncidentDetail> {
  requirePermission(actor.permissions, "incidents.read");

  const [incident] = await db
    .select()
    .from(schema.incidents)
    .where(eq(schema.incidents.id, incidentId))
    .limit(1);

  if (!incident) {
    throw new AppError("incident_not_found", 404, { incidentId });
  }

  const events = await db
    .select()
    .from(schema.incidentEvents)
    .where(eq(schema.incidentEvents.incidentId, incidentId))
    .orderBy(asc(schema.incidentEvents.occurredAt));

  const linked = await db
    .select({
      incidentId: schema.incidentAlerts.incidentId,
      alertId: schema.incidentAlerts.alertId,
      addedAt: schema.incidentAlerts.addedAt,
    })
    .from(schema.incidentAlerts)
    .where(eq(schema.incidentAlerts.incidentId, incidentId))
    .orderBy(asc(schema.incidentAlerts.addedAt));

  return {
    ...incident,
    status: incident.status as IncidentStatus,
    timeline: events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus as IncidentStatus | null,
      toStatus: e.toStatus as IncidentStatus,
      actorUserId: e.actorUserId,
      occurredAt: e.occurredAt,
      metadata: e.metadata as Record<string, unknown>,
    })),
    alerts: linked,
  };
}
