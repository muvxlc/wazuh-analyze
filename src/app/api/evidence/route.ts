import { z } from "zod";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { toErrorResponse } from "../../../server/http/error-response";
import { requirePermission } from "../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import {
  createEvidenceRecord,
  listEvidenceRecords,
} from "../../../server/evidence/service";

const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    alertId: z.string().uuid().optional(),
    incidentId: z.string().uuid().optional(),
    evidenceType: z.enum(["ioc", "log", "note", "network", "threat_intel"]).optional(),
    validated: z.enum(["true", "false"]).optional(),
  })
  // Evidence is always scoped to an alert or an incident — never list everything.
  .refine((v) => Boolean(v.alertId) !== Boolean(v.incidentId), {
    message: "exactly one of alertId or incidentId required",
  });

const createSchema = z.object({
  alertId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  evidenceType: z.enum(["ioc", "log", "note", "network", "threat_intel"]),
  title: z.string().min(1).max(512),
  content: z.unknown(),
  provenanceEndpoint: z.string().max(2048).nullable().optional(),
  eventAt: z.string().datetime().nullable().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, "incidents.read");

    const parsed = listSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const data = await listEvidenceRecords(db, {
      limit: parsed.limit,
      alertId: parsed.alertId,
      incidentId: parsed.incidentId,
      evidenceType: parsed.evidenceType,
      validated: parsed.validated === undefined ? undefined : parsed.validated === "true",
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, "incidents.manage");

    const body = createSchema.parse(await request.json());
    const data = await createEvidenceRecord(db, {
      ...body,
      eventAt: body.eventAt ? new Date(body.eventAt) : null,
      createdByUserId: user.id,
    });
    return Response.json({ data }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
