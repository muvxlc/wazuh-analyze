import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { normalizeWazuhAlert } from "../alerts/normalize";
import { persistAlert } from "../alerts/alert-repository";
import { createAlertFingerprint } from "../alerts/fingerprint";
import { deleteExpiredAlerts } from "./retention";

const pool = createTestPool();
const db = drizzle(pool, { schema });

async function seedOldAlerts(count: number, daysAgo: number, prefix: string = "evt"): Promise<void> {
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const raw = {
      id: `${prefix}-${i}`,
      timestamp: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
      rule: { level: 3, id: `${300000 + i}`, description: "Retention test", groups: [] },
      agent: { id: `agent-ret-${i}`, name: `host-ret-${i}` },
    };
    const normalized = normalizeWazuhAlert(raw);
    await persistAlert(db, normalized);
  }
}

describe("deleteExpiredAlerts integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
  });

  it("deletes alerts older than cutoff", async () => {
    await seedOldAlerts(5, 100);
    const now = new Date();
    const result = await deleteExpiredAlerts(db, { before: now, batchSize: 10 });
    expect(result).toBeGreaterThan(0);

    const remaining = await db.select({ id: schema.alerts.id }).from(schema.alerts);
    expect(remaining).toHaveLength(0);
  });

  it("preserves alerts newer than cutoff", async () => {
    await seedOldAlerts(3, 100, "evt-expired");
    // Seed fresh alerts with future ingestedAt so they survive deletion
    const now = new Date();
    for (let i = 0; i < 2; i++) {
      const raw = {
        id: `evt-fresh-${Date.now()}-${i}`,
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        rule: { level: 3, id: `${900000 + i}`, description: "Fresh retention test", groups: [] },
        agent: { id: `agent-fresh-${i}`, name: `host-fresh-${i}` },
      };
      const normalized = normalizeWazuhAlert(raw);
      await db.insert(schema.alerts).values({
        ...normalized,
        fingerprint: createAlertFingerprint(normalized),
        ingestedAt: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),
      });
    }
    const result = await deleteExpiredAlerts(db, { before: now, batchSize: 10 });
    expect(result).toBe(3);

    const remaining = await db.select({ id: schema.alerts.id }).from(schema.alerts);
    expect(remaining).toHaveLength(2);
  });

  it("respects batchSize limit", async () => {
    await seedOldAlerts(10, 100, "evt-batch");
    const now = new Date();
    const result = await deleteExpiredAlerts(db, { before: now, batchSize: 3 });
    expect(result).toBe(3);

    const remaining = await db.select({ id: schema.alerts.id }).from(schema.alerts);
    expect(remaining).toHaveLength(7);
  });

  it("is safe to call when no expired alerts exist", async () => {
    await seedOldAlerts(2, 1, "evt-safe");
    // Use a cutoff in the past — no alerts should match
    const past = new Date("2000-01-01T00:00:00Z");
    const result = await deleteExpiredAlerts(db, { before: past, batchSize: 10 });
    expect(result).toBe(0);
  });
});
