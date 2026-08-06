import "server-only";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import type { Database, DatabaseTransaction } from "../db/types";
import { AppError } from "../errors";

/**
 * Compute replay-key hash from `<timestamp>\n<signature>` literal bytes.
 * This is the canonical key for the webhook_replay_keys unique index.
 */
export function computeReplayKeyHash(
  timestamp: string,
  signature: string,
): string {
  const input = `${timestamp}\n${signature}`;
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Insert a replay key row within the current transaction.
 * Maps the 23505 unique-constraint violation to a 409 replay-rejected AppError.
 */
export async function insertReplayKey(
  tx: DatabaseTransaction,
  args: {
    keyHash: string;
    expiresAt: Date;
  },
): Promise<void> {
  try {
    await tx.insert(schema.webhookReplayKeys).values({
      keyHash: args.keyHash,
      expiresAt: args.expiresAt,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("replay_rejected", 409);
    }
    throw error;
  }
}

/**
 * Confirm a replay row exists (used by idempotent GET-style probes — not the
 * ingestion path, but exposed for test parity and future GET endpoint).
 */
export async function findReplayKey(
  db: Database,
  keyHash: string,
): Promise<{ id: string; keyHash: string; expiresAt: Date } | null> {
  const [row] = await db
    .select({
      id: schema.webhookReplayKeys.id,
      keyHash: schema.webhookReplayKeys.keyHash,
      expiresAt: schema.webhookReplayKeys.expiresAt,
    })
    .from(schema.webhookReplayKeys)
    .where(eq(schema.webhookReplayKeys.keyHash, keyHash))
    .limit(1);

  return row ?? null;
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
