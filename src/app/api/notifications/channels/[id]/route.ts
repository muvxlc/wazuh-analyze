import "server-only";

import { eq } from "drizzle-orm";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { requirePermission } from "../../../../../server/authorization/require";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { notificationChannels } from "../../../../../server/db/schema/notifications";
import { AppError } from "../../../../../server/errors";

function token(request: Request): string | null {
  return request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, token(request));
    requirePermission(user.permissions, "notifications.manage");
    const { id } = await context.params;

    const [deleted] = await db
      .delete(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .returning({ id: notificationChannels.id });
    if (!deleted) throw new AppError("not_found", 404);

    return Response.json({ data: { id: deleted.id } }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
