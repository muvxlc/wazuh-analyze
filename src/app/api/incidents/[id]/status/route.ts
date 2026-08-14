import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { transitionIncident } from "../../../../../server/incidents/workflow";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import { enqueueNotification } from "../../../../../server/daemon/queue";

const bodySchema = z.object({
  to: z.enum(["investigating", "mitigated", "resolved", "open"]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    const { id } = await context.params;
    const body = bodySchema.parse(await request.json());
    const data = await transitionIncident(
      db,
      { userId: user.id, role: user.role, permissions: new Set(user.permissions) },
      { incidentId: id, to: body.to },
      {
        requestId,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      },
    );

    // Notify on reopen. Route is server-only; enqueueNotification (daemon/queue)
    // must NOT be imported from workflow.ts because incident-detail.tsx is a
    // client component that transitively imports workflow.ts.
    if (body.to === "open") {
      void enqueueNotification({
        type: "incident.opened",
        targetId: id,
        severity: data.severity,
        title: data.title,
        summary: `Incident reopened by ${user.id}`,
      }).catch((e) => console.error("notify incident.opened failed", e));
    }

    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
