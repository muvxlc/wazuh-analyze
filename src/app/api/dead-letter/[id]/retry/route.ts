import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { requirePermission } from "../../../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import { retrySingleDeadLetter } from "../../../../../server/ingestion/dead-letter-retry";
import { eq } from "drizzle-orm";
import * as schema from "../../../../../server/db/schema";

export async function POST(
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
    requirePermission(user.permissions, "settings.manage");

    const { id } = await context.params;
    z.string().uuid().parse(id);
    const result = await retrySingleDeadLetter(db, id);
    if (!result) {
      // Row may not exist, or may already be claimed (in-flight retry). Probe
      // existence to distinguish 404 from 409.
      const exists = await db
        .select({ id: schema.deadLetters.id })
        .from(schema.deadLetters)
        .where(eq(schema.deadLetters.id, id))
        .limit(1);
      if (!exists[0]) {
        return Response.json(
          { error: { code: "not_found", requestId } },
          { status: 404, headers: { "cache-control": "no-store" } },
        );
      }
      return Response.json(
        { error: { code: "dead_letter_not_retryable", requestId } },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
