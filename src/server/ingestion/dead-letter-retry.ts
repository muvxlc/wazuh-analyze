import "server-only";

import { eq, sql } from "drizzle-orm";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { AppError } from "../errors";
import { persistAlert } from "../alerts/alert-repository";
import { createAlertFingerprint } from "../alerts/fingerprint";
import { retryDeadLetter } from "./dead-letter";
import type { RawEventRecord } from "../wazuh/indexer-search";
import { eventToNormalized } from "./replay";

export interface RetryDeadLetterResult {
  id: string;
  status: "retried" | "duplicate" | "failed";
  errorReason?: string;
}

/**
 * Retry a single dead letter: atomic-claim the row (open → retrying), then
 * re-process it through the same normalize+persist path as live ingestion.
 *
 * Outcome mapping:
 *  - normalize/persist succeeds → row deleted (recovered) — returned as
 *    inserted/duplicate.
 *  - persist fails again → row back to 'open' with fresh errorReason.
 *
 * Returns null when the row is already claimed (not in 'open') — caller should
 * treat as a no-op.
 */
export async function retrySingleDeadLetter(
  db: Database,
  id: string,
): Promise<RetryDeadLetterResult | null> {
  const claimed = await retryDeadLetter({ db, id });
  if (!claimed) return null;

  try {
    const event = claimed.rawPayload as unknown as RawEventRecord;
    const normalized = eventToNormalized(event);
    normalized.fingerprint = createAlertFingerprint(normalized);
    const persistResult = await persistAlert(db, normalized);

    // Recovered: remove from DLQ.
    await db
      .delete(schema.deadLetters)
      .where(eq(schema.deadLetters.id, id));
    return {
      id,
      status: persistResult.inserted ? "retried" : "duplicate",
    };
  } catch (err) {
    // Failed again: release back to 'open' with the fresh error, keeping
    // retriedAt as evidence the row was attempted.
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.deadLetters)
      .set({ status: "open", lastError: reason.slice(0, 1024) })
      .where(eq(schema.deadLetters.id, id));
    return { id, status: "failed", errorReason: reason };
  }
}
