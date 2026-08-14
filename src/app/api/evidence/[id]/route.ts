import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { toErrorResponse } from "../../../../server/http/error-response";
import { requirePermission } from "../../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import {
  validateEvidenceRecord,
  deleteEvidenceRecord,
  type EvidenceScope,
} from "../../../../server/evidence/service";

/**
 * Extract caller scope from query string: `alertId=<uuid>` or `incidentId=<uuid>`.
 * Exactly one required — mirrors listEvidenceRecords' scoping so callers cannot
 * target records outside a scope they name.
 */
function parseScope(request: Request): EvidenceScope {
  const params = new URL(request.url).searchParams;
  const alertId = params.get("alertId");
  const incidentId = params.get("incidentId");
  const scope = z
    .object({
      alertId: z.string().uuid().optional(),
      incidentId: z.string().uuid().optional(),
    })
    .refine((v) => Boolean(v.alertId) !== Boolean(v.incidentId), {
      message: "exactly one of alertId or incidentId required",
    })
    .parse({ alertId, incidentId });
  return { alertId: scope.alertId ?? null, incidentId: scope.incidentId ?? null };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, "incidents.manage");

    const { id } = await context.params;
    const scope = parseScope(request);
    const data = await validateEvidenceRecord(db, id, user.id, scope);
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, "incidents.manage");

    const { id } = await context.params;
    const scope = parseScope(request);
    await deleteEvidenceRecord(db, id, scope);
    return Response.json({ data: { id } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
