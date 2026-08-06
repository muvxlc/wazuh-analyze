import "server-only";

import { loadConfig } from "../../../../../server/config";
import { createDatabase } from "../../../../../server/db/client";
import { extractWebhookHeaders, verifyWebhookRequest } from "../../../../../server/ingestion/signature";
import { ingestWazuhAlert } from "../../../../../server/ingestion/ingest";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { getRequestMetadata } from "../../../../../server/http/request-metadata";
import { AppError } from "../../../../../server/errors";
import { runAlertAnalysis } from "../../../../../server/ai/analyze-service";

const MAX_BODY_SIZE = 1_048_576; // 1 MiB fallback; actual max from config

/**
 * POST /api/integrations/wazuh/alerts
 * HMAC-SHA256 verified Wazuh alert ingestion endpoint.
 *
 * Status codes:
 * 202 — Accepted (alert persisted, new or duplicate handled)
 * 401 — Missing/invalid headers, bad signature, expired timestamp
 * 409 — Replay key or alert dedup key already seen
 * 413 — Body exceeds configured max bytes
 * 422 — Invalid JSON body or invalid alert payload structure
 * 500 — Internal server error (redacted)
 */
export async function POST(request: Request): Promise<Response> {
  const metadata = getRequestMetadata(request);
  const config = loadConfig(process.env);

  const { db, pool } = createDatabase(config.databaseUrl);

  try {
    // -- Content-Length pre-check ----------------------------------------
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      const declared = Number(contentLength);
      if (!Number.isInteger(declared) || declared < 0 || declared > config.webhookMaxBodyBytes) {
        return Response.json(
          { error: { code: "body_too_large", requestId: metadata.requestId } },
          { status: 413, headers: { "cache-control": "no-store" } },
        );
      }
    }

    // -- Read body with enforced ceiling ---------------------------------
    const maxBytes = config.webhookMaxBodyBytes;
    const bodyArrayBuffer = await request.arrayBuffer();
    if (bodyArrayBuffer.byteLength > maxBytes) {
      return Response.json(
        { error: { code: "body_too_large", requestId: metadata.requestId } },
        { status: 413, headers: { "cache-control": "no-store" } },
      );
    }
    const body = new Uint8Array(bodyArrayBuffer);

    // -- Extract and verify HMAC -----------------------------------------
    const { timestamp, signature } = extractWebhookHeaders(request);

    try {
      verifyWebhookRequest({
        request: { body, timestamp, signature },
        secret: new TextEncoder().encode(config.webhookHmacSecret),
        now: new Date(),
        maxAgeMs: config.webhookReplayWindowSeconds * 1000,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return Response.json(
          { error: { code: error.code, requestId: metadata.requestId } },
          {
            status: error.status,
            headers: { "cache-control": "no-store" },
          },
        );
      }
      throw error;
    }

    // -- Ingest: atomic replay-key + alert insert ------------------------
    const result = await ingestWazuhAlert({
      db,
      body,
      timestamp: timestamp!,
      signature: signature!,
      replayWindowSeconds: config.webhookReplayWindowSeconds,
    });

    if (result.inserted && config.socAutoAnalyze && result.alert.level >= config.socAutoAnalyzeMinLevel) {
      const alertId = result.alert.id;
      // ponytail: in-memory unmanaged background execution; migrate to dedicated background job queue if concurrency grows.
      void (async () => {
        const bg = createDatabase(config.databaseUrl);
        try {
            await runAlertAnalysis(
              bg.db,
              { userId: "system-auto", role: "admin", permissions: new Set(["alerts.analyze", "alerts.details"]) },
              alertId,
              { enrich: true },
              metadata,
              config,
            );
        } catch {
          // Fire-and-forget: ignore execution failures
        } finally {
          await bg.pool.end();
        }
      })();
    }

    // Duplicate alert (same fingerprint) -> 409 per spec
    const status = result.inserted ? 202 : 409;
    return Response.json(
      { data: { alertId: result.alert.id, inserted: result.inserted } },
      {
        status,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return toErrorResponse(error, metadata.requestId);
  } finally {
    await pool.end();
  }
}