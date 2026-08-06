import "server-only";

import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { AppError } from "../errors";
import { normalizeWazuhAlert } from "../alerts/normalize";
import { persistAlert, mapAlertRow } from "../alerts/alert-repository";
import { createAlertFingerprint } from "../alerts/fingerprint";
import type { AlertRecord } from "../alerts/types";
import { computeReplayKeyHash, insertReplayKey } from "./replay";

export interface IngestArgs {
  db: Database;
  body: Uint8Array;
  timestamp: string;
  signature: string;
  replayWindowSeconds: number;
}

export interface IngestResult {
  alert: AlertRecord;
  inserted: boolean;
}

/**
 * Atomically: insert replay-key row, parse + persist alert.
 * Replay-key insert + alert insert run in one transaction.
 * Duplicate replay key -> 409.
 * Duplicate alert (fingerprint / wazuhEventId) -> 409.
 */
export async function ingestWazuhAlert(args: IngestArgs): Promise<IngestResult> {
  const { db, body, timestamp, signature, replayWindowSeconds } = args;

  // Compute replay key outside transaction (pure function over inputs).
  const keyHash = computeReplayKeyHash(timestamp, signature);
  const expiresAt = new Date(Date.now() + replayWindowSeconds * 1000);

  // Parse + validate JSON body BEFORE opening the transaction.
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    throw new AppError("invalid_json_body", 422);
  }

  let normalized;
  try {
    normalized = normalizeWazuhAlert(parsed);
  } catch {
    throw new AppError("invalid_alert_payload", 422);
  }

  // Ensure fingerprint is set before persisting
  if (!normalized.fingerprint) {
    normalized.fingerprint = createAlertFingerprint(normalized);
  }

  return db.transaction(async (tx) => {
    await insertReplayKey(tx, { keyHash, expiresAt });

    try {
      const result = await persistAlert(tx, normalized);
      if (!result.inserted) {
        // Duplicate fingerprint — return 409 for the route layer.
        throw new AppError("duplicate_alert", 409);
      }
      return { alert: result.alert, inserted: result.inserted };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isUniqueViolation(error)) {
        throw new AppError("duplicate_alert", 409);
      }
      throw error;
    }
  });
}

/**
 * Probe-only: returns true if the alert already exists by fingerprint,
 * without inserting. Exposed for tests that want to assert idempotency
 * without re-running the full transaction.
 */
export async function findAlertByFingerprint(
  db: Database,
  fingerprint: string,
): Promise<AlertRecord | null> {
  const [row] = await db
    .select()
    .from(schema.alerts)
    .where(eq(schema.alerts.fingerprint, fingerprint))
    .limit(1);
  if (!row) return null;
  return mapAlertRow(row);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: string;
    cause?: { code?: string };
    details?: { code?: string };
  };
  return e.code === "23505" || e.cause?.code === "23505" || e.details?.code === "23505";
}