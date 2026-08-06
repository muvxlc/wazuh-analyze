import { z } from "zod";
import { createDatabase } from "../../../../../../server/db/client";
import { loadConfig } from "../../../../../../server/config";
import { authenticateRequest } from "../../../../../../server/auth/authenticate";
import { approveAction } from "../../../../../../server/actions/action-service";
import { assertCsrfSafe } from "../../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../../../server/auth/cookies";
import { enqueueActionExecution } from "../../../../../../server/daemon/queue";

const approveSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; actionId: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const { actionId } = await context.params;
    const body = approveSchema.parse(await request.json());
    
    const actor = { userId: user.id, role: user.role, permissions: new Set(user.permissions) };
    await approveAction(db, actor, actionId, body.decision, body.note);
    
    // Enqueue Wazuh active-response execution when approved
    if (body.decision === "approve") {
      void enqueueActionExecution(actionId).catch(console.error);
    }
    
    return Response.json({ data: { actionId, decision: body.decision } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
