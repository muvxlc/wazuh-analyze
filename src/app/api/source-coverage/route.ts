import { z } from "zod";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { toErrorResponse } from "../../../server/http/error-response";
import { requirePermission } from "../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import {
  listSourceCoverage,
  upsertSourceCoverage,
} from "../../../server/source-coverage/service";

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sourceType: z.enum(["deployment", "feed", "manual", "api"]).optional(),
  enabled: z.enum(["true", "false"]).optional(),
  staleOnly: z.enum(["true", "false"]).optional(),
});

const upsertSchema = z.object({
  sourceKey: z.string().min(1).max(200),
  sourceType: z.enum(["deployment", "feed", "manual", "api"]),
  endpoint: z.string().max(2048).nullable().optional(),
  credentialScope: z.string().min(1).max(256),
  enabled: z.boolean().optional(),
  itemCount: z.coerce.number().int().min(0).nullable().optional(),
  parseErrorCount: z.coerce.number().int().min(0).optional(),
  freshnessSlaMs: z.coerce.number().int().min(0).nullable().optional(),
  contractVersion: z.string().max(64).nullable().optional(),
  lastError: z.string().max(512).nullable().optional(),
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
    requirePermission(user.permissions, "settings.manage");

    const parsed = listSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const data = await listSourceCoverage(db, {
      limit: parsed.limit,
      sourceType: parsed.sourceType,
      enabled: parsed.enabled === undefined ? undefined : parsed.enabled === "true",
      staleOnly: parsed.staleOnly === "true",
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
    requirePermission(user.permissions, "settings.manage");

    const body = upsertSchema.parse(await request.json());
    const data = await upsertSourceCoverage(db, {
      ...body,
      endpoint: body.endpoint ?? null,
      createdByUserId: user.id,
    });
    return Response.json({ data }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
