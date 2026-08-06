import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";

export interface CleanupSessionsInput {
  before: Date;
  batchSize: number;
}

/**
 * Bounded session cleanup: selects expired sessions using FOR UPDATE SKIP LOCKED
 * to prevent concurrent workers from processing the same rows.
 * Returns the number of rows deleted in this invocation.
 */
export async function cleanupExpiredSessions(
  db: Database,
  input: CleanupSessionsInput,
): Promise<number> {
  const { before, batchSize } = input;

  return db.transaction(async (tx) => {
    // Select expired session IDs with FOR UPDATE SKIP LOCKED
    const batch = await tx
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(
        and(
          or(
            lte(schema.sessions.expiresAt, before),
            lte(schema.sessions.absoluteExpiresAt, before),
          ),
          isNull(schema.sessions.revokedAt),
        ),
      )
      .orderBy(asc(schema.sessions.createdAt))
      .limit(batchSize)
      .for("update", { skipLocked: true })
      .execute();

    if (batch.length === 0) {
      return 0;
    }

    const ids = batch.map((row) => row.id);

    // Revoke selected sessions
    await tx
      .update(schema.sessions)
      .set({ revokedAt: before })
      .where(inArray(schema.sessions.id, ids));

    return batch.length;
  });
}
