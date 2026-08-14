import "server-only";

import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { transitionIncident, setIncidentAssignee } from "../../../../server/incidents/workflow";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  to: z.enum(["investigating", "mitigated", "resolved", "open"]).optional(),
  assigneeUserId: z.union([z.string().uuid(), z.null()]).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    const actor = { userId: user.id, role: user.role, permissions: new Set(user.permissions) };
    const { ids, to, assigneeUserId } = bodySchema.parse(await request.json());

    if (!to && assigneeUserId === undefined) {
      return Response.json({ error: "must provide to or assigneeUserId" }, { status: 400 });
    }

    const meta = {
      requestId,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    };

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          if (to) {
            await transitionIncident(db, actor, { incidentId: id, to }, meta);
          }
          if (assigneeUserId !== undefined) {
            await setIncidentAssignee(db, actor, id, assigneeUserId, meta);
          }
          return { id, ok: true } as const;
        } catch (err) {
          return { id, ok: false, error: err instanceof Error ? err.message : "failed" } as const;
        }
      }),
    );

    const succeeded = results.filter((r) => r.ok).length;
    return Response.json(
      { data: { results, succeeded, failed: results.length - succeeded } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
