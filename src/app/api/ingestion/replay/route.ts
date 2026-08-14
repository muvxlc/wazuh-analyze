import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { toErrorResponse } from "../../../../server/http/error-response";
import { requirePermission } from "../../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { replayIndexerAlerts } from "../../../../server/ingestion/replay";
import { writeAuditEvent } from "../../../../server/audit/audit-service";
import { getQueuePhase, setQueuePhase } from "../../../../server/daemon/progress";

const REPLAY_GATE_MS = 60_000;
const REPLAY_QUEUE = "ingestion-replay";

const querySchema = z.object({
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  maxDeadLetters: z.coerce.number().int().min(1).max(100).optional(),
});

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

    // Rate gate: one manual replay per minute. Marker lives in queue_progress so
    // the gate survives restarts and is visible in the queues UI.
    const last = await getQueuePhase(db, REPLAY_QUEUE, "manual");
    if (last && Date.now() - last.updatedAt.getTime() < REPLAY_GATE_MS) {
      return Response.json(
        { error: "replay_gate_active", retryAfterMs: REPLAY_GATE_MS },
        { status: 429, headers: { "cache-control": "no-store" } },
      );
    }

    const parsed = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    await setQueuePhase(db, REPLAY_QUEUE, "manual", "processing", { jobId: requestId });
    const data = await replayIndexerAlerts({
      db,
      config: config.wazuh,
      since: parsed.since,
      limit: parsed.limit,
      maxDeadLetters: parsed.maxDeadLetters,
    });
    await setQueuePhase(db, REPLAY_QUEUE, "manual", "completed", {
      jobId: requestId,
      detail: `inserted=${data.inserted} duplicates=${data.duplicates} dlq=${data.deadLettersInserted}`,
    });
    await writeAuditEvent(db, {
      actorUserId: user.id,
      targetType: "source",
      targetId: "indexer_replay",
      action: "system.health",
      ipAddress: null,
      userAgent: null,
      requestId,
      detail: { replay: data },
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
