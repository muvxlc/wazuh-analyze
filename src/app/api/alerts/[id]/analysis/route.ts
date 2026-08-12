import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { requirePermission } from "../../../../../server/authorization/require";
import { listAlertAnalyses } from "../../../../../server/ai/analyze-service";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import { enqueueAlertAnalysis, QUEUE_ANALYZE_ALERT } from "../../../../../server/daemon/queue";
import { setQueuePhase, getQueuePhase } from "../../../../../server/daemon/progress";

const bodySchema = z.object({
  connectionId: z.string().uuid().optional(),
  enrich: z.boolean().optional(),
});

// Scrub internal endpoints/URLs from provider error messages before exposing to the browser.
// detail is stored verbatim in the DB for ops debugging; only the client response is redacted.
function redactDetail(s: string | undefined): string | undefined {
  if (!s) return s;
  return s.replace(/https?:\/\/[^\s"'<>]+/g, "[endpoint-redacted]");
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const { id } = await context.params;
    const actor = { userId: user.id, role: user.role, permissions: new Set(user.permissions) };
    const [data, progress] = await Promise.all([
      listAlertAnalyses(db, actor, id),
      getQueuePhase(db, QUEUE_ANALYZE_ALERT, id),
    ]);
    return Response.json({
      data,
      progress: progress ? { phase: progress.phase, status: progress.status, detail: redactDetail(progress.detail) } : null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    const { id } = await context.params;
    requirePermission(user.permissions, "alerts.analyze");
    const body = request.body ? bodySchema.parse(await request.json().catch(() => ({}))) : {};
    // Mark as queued before enqueue so GET can immediately return "queued"
    await setQueuePhase(db, QUEUE_ANALYZE_ALERT, id, "queued");
    try {
      // Manual Analyze must bypass stale singleton jobs from prior attempts.
      await enqueueAlertAnalysis(id, { force: true, ...body });
    } catch (enqueueErr) {
      // Enqueue failed — mark progress as failed so the UI doesn't stay stuck at "queued"
      await setQueuePhase(db, QUEUE_ANALYZE_ALERT, id, "failed", {
        detail: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
      }).catch(() => {/* best-effort */});
      throw enqueueErr;
    }
    return Response.json({ data: { queued: true, alertId: id } }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
