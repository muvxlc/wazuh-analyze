import "server-only";

import { z } from "zod";
import { desc, sql } from "drizzle-orm";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { requirePermission } from "../../../../server/authorization/require";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import * as schema from "../../../../server/db/schema";
import { buildIncidentWhere, fetchUserNames, type IncidentListQuery } from "../../../../server/incidents/query";
import { PERMISSIONS } from "../../../../server/authorization/permissions";

const querySchema = z.object({
  status: z.enum(["open", "investigating", "mitigated", "resolved"]).optional(),
  agentId: z.string().optional(),
  ruleId: z.string().optional(),
  severity: z.string().optional(),
  assigneeUserId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
});

const EXPORT_LIMIT = 5000;
const COLUMNS = [
  "incidentNumber", "title", "status", "severity",
  "agentId", "ruleId", "assigneeDisplayName", "alertCount",
  "createdAt", "updatedAt", "closedAt",
] as const;

// ponytail: CSV built inline; cap EXPORT_LIMIT. Stream/loop if incidents ever exceed this.
function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, PERMISSIONS.incidentsList);
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const where = buildIncidentWhere(parsed as IncidentListQuery);

    const rows = await db
      .select({
        id: schema.incidents.id,
        incidentNumber: schema.incidents.incidentNumber,
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
      .limit(EXPORT_LIMIT);

    const nameMap = await fetchUserNames(
      db,
      rows.map((r) => r.assigneeUserId).filter((v): v is string => Boolean(v)),
    );

    // alert counts per incident (single grouped query).
    const counts = rows.length
      ? await db
          .select({ incidentId: schema.incidentAlerts.incidentId, count: sql<number>`count(*)::int` })
          .from(schema.incidentAlerts)
          .where(sql`${schema.incidentAlerts.incidentId} IN ${rows.map((r) => r.id)}`)
          .groupBy(schema.incidentAlerts.incidentId)
      : [];
    const countMap = new Map(counts.map((c) => [c.incidentId, c.count] as const));

    const lines = [COLUMNS.join(",")];
    for (const r of rows) {
      const assigneeDisplayName = r.assigneeUserId ? nameMap.get(r.assigneeUserId) ?? null : null;
      const cells = [
        r.incidentNumber, r.title, r.status, r.severity,
        r.agentId, r.ruleId, assigneeDisplayName, countMap.get(r.id) ?? 0,
        r.createdAt.toISOString(), r.updatedAt.toISOString(), r.closedAt?.toISOString() ?? "",
      ];
      lines.push(cells.map(csvEscape).join(","));
    }

    const csv = lines.join("\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="incidents.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
