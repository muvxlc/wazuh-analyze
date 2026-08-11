import "server-only";

import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { queueProgress } from "../../../../../server/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    await authenticateRequest(db, token); // Any authenticated user can check sync status

    const [progress] = await db
      .select({
        phase: queueProgress.phase,
        status: queueProgress.status,
      })
      .from(queueProgress)
      .where(eq(queueProgress.jobId, id))
      .limit(1);

    if (!progress) {
      return Response.json({ data: { phase: "queued", status: "running" } }, { status: 200 });
    }

    return Response.json({ data: progress }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
