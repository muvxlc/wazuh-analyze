import { and, eq, gt } from "drizzle-orm";

import type { Database } from "../db/types";
import * as schema from "../db/schema";
import { buildSignatureKey } from "./signature";

// FP (false-positive) memory match check.
//
// Two-part design so the caller (queue.ts in Wave 2 Task B2) composes safety:
//   1. checkFpMatch(db, meta, opts) -> finds a LIVE + ENABLED row by signature
//      key (no severity floor here — pure existence lookup).
//   2. shouldApplyFp(fp, alertLevel, floor, now) -> pure policy gate that
//      enforces the severity floor and expiry on the found row.
// The caller MUST run both: `const m = await checkFpMatch(...); if (m && shouldApplyFp(m, level, floor)) ...`.
// This split keeps the DB query trivial and the policy testable without a DB.

export interface FpSignatureRow {
  enabled: boolean | null;
  expiresAt: Date | null;
}

/**
 * Pure policy gate. Returns true iff the FP match should actually suppress.
 *
 * Rules (any fail => false, i.e. do NOT suppress):
 *   - row disabled (enabled !== true)
 *   - expiry missing OR expired (expiresAt <= now) — `<=` so exact-equal is expired
 *   - alertLevel >= severity floor (Wazuh critical, def 12) — NEVER suppress critical
 *
 * `now` is injectable for deterministic tests.
 */
export function shouldApplyFp(
  fp: { enabled: boolean | null; expiresAt: Date | null },
  alertLevel: number,
  floor: number,
  now: Date = new Date(),
): boolean {
  if (fp.enabled !== true) return false;
  if (fp.expiresAt === null) return false;
  if (fp.expiresAt.getTime() <= now.getTime()) return false;
  if (alertLevel >= floor) return false; // severity floor — never suppress critical
  return true;
}

/**
 * Find a live + enabled FP signature row by key. Does NOT apply the severity
 * floor — the caller composes `shouldApplyFp` on the returned row.
 *
 * @returns slim row (id, signatureKey, expiresAt, enabled) or null when:
 *   - master toggle off (!opts.enabled)
 *   - no key derivable (null/empty ruleId)
 *   - no enabled, unexpired row matches
 */
export async function checkFpMatch(
  db: Database,
  meta: { ruleId: string | null; agentId: string | null; level: number },
  opts: { enabled: boolean },
): Promise<{
  id: string;
  signatureKey: string;
  expiresAt: Date;
  enabled: boolean;
} | null> {
  if (!opts.enabled) return null; // master toggle off
  const key = buildSignatureKey(meta.ruleId, meta.agentId, meta.level);
  if (!key) return null; // no rule => no signature

  const now = new Date();
  const rows = await db
    .select({
      id: schema.fpSignatures.id,
      signatureKey: schema.fpSignatures.signatureKey,
      expiresAt: schema.fpSignatures.expiresAt,
      enabled: schema.fpSignatures.enabled,
    })
    .from(schema.fpSignatures)
    .where(
      and(
        eq(schema.fpSignatures.signatureKey, key),
        eq(schema.fpSignatures.enabled, true),
        gt(schema.fpSignatures.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    signatureKey: row.signatureKey,
    expiresAt: row.expiresAt,
    enabled: row.enabled,
  };
}
