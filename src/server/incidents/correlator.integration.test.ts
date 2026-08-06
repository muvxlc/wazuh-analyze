import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { correlateAlert } from "./correlator";

describe("incidents correlator (integration)", () => {
  const pool = createTestPool();
  const db = drizzle(pool, { schema });

  beforeAll(async () => {
    await resetTestDatabase(pool);
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertTestAlert(opts: {
    fingerprint: string;
    level: number;
    agentId?: string;
    ruleId?: string;
    wazuhTimestamp?: Date;
  }): Promise<string> {
    const [inserted] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: opts.fingerprint,
        level: opts.level,
        agentId: opts.agentId ?? "001",
        agentName: "prod-web-01",
        ruleId: opts.ruleId ?? "5710",
        ruleDescription: "SSH brute force attempt",
        wazuhTimestamp: opts.wazuhTimestamp ?? new Date(),
        rawPayload: { rule: { level: opts.level, id: opts.ruleId ?? "5710" } },
      })
      .returning({ id: schema.alerts.id });
    return inserted!.id;
  }

  it("ignores alerts with level < 7", async () => {
    const alertId = await insertTestAlert({ fingerprint: "fp-low", level: 6 });
    const res = await correlateAlert(db, alertId);
    expect(res).toBeNull();

    const all = await db.select().from(schema.incidents);
    expect(all).toHaveLength(0);
  });

  it("creates a new incident for level >= 7 with severity mapping", async () => {
    const alertId = await insertTestAlert({ fingerprint: "fp-med", level: 9 });
    const res = await correlateAlert(db, alertId);

    expect(res).not.toBeNull();
    expect(res!.created).toBe(true);

    const [incident] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, res!.incidentId));
    expect(incident).toBeDefined();
    expect(incident!.severity).toBe("medium");
    expect(incident!.agentId).toBe("001");
    expect(incident!.ruleId).toBe("5710");

    const mapped = await db.select().from(schema.incidentAlerts).where(eq(schema.incidentAlerts.incidentId, incident!.id));
    expect(mapped).toHaveLength(1);
    expect(mapped[0]!.alertId).toBe(alertId);

    const events = await db.select().from(schema.incidentEvents).where(eq(schema.incidentEvents.incidentId, incident!.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.toStatus).toBe("open");
  });

  it("deduplicates alerts for same agent+rule within 60min window into single incident", async () => {
    const baseTime = new Date("2026-08-06T12:00:00Z");
    const a1 = await insertTestAlert({ fingerprint: "fp-1", level: 7, wazuhTimestamp: baseTime });
    const a2 = await insertTestAlert({ fingerprint: "fp-2", level: 8, wazuhTimestamp: new Date(baseTime.getTime() + 15 * 60000) });
    const a3 = await insertTestAlert({ fingerprint: "fp-3", level: 10, wazuhTimestamp: new Date(baseTime.getTime() + 45 * 60000) });

    const r1 = await correlateAlert(db, a1);
    expect(r1!.created).toBe(true);

    const r2 = await correlateAlert(db, a2);
    expect(r2!.created).toBe(false);
    expect(r2!.incidentId).toBe(r1!.incidentId);

    const r3 = await correlateAlert(db, a3);
    expect(r3!.created).toBe(false);
    expect(r3!.incidentId).toBe(r1!.incidentId);

    const allIncidents = await db.select().from(schema.incidents);
    expect(allIncidents).toHaveLength(1);

    const links = await db.select().from(schema.incidentAlerts).where(eq(schema.incidentAlerts.incidentId, r1!.incidentId));
    expect(links).toHaveLength(3);
  });

  it("creates a separate incident when outside 60min window or when previous is resolved", async () => {
    const baseTime = new Date("2026-08-06T10:00:00Z");
    const a1 = await insertTestAlert({ fingerprint: "fp-old", level: 12, wazuhTimestamp: baseTime });
    const r1 = await correlateAlert(db, a1);

    // Outside window (>60min later)
    const a2 = await insertTestAlert({ fingerprint: "fp-new", level: 12, wazuhTimestamp: new Date(baseTime.getTime() + 65 * 60000) });
    const r2 = await correlateAlert(db, a2);
    expect(r2!.created).toBe(true);
    expect(r2!.incidentId).not.toBe(r1!.incidentId);

    // Resolve r2, then insert another immediately after -> must create a third incident
    await db.update(schema.incidents).set({ status: "resolved" }).where(eq(schema.incidents.id, r2!.incidentId));
    const a3 = await insertTestAlert({ fingerprint: "fp-after-resolve", level: 12, wazuhTimestamp: new Date(baseTime.getTime() + 66 * 60000) });
    const r3 = await correlateAlert(db, a3);
    expect(r3!.created).toBe(true);
    expect(r3!.incidentId).not.toBe(r2!.incidentId);

    const allIncidents = await db.select().from(schema.incidents);
    expect(allIncidents).toHaveLength(3);
  });

  it("handles concurrent correlation cleanly without duplicates (concurrency test)", async () => {
    const now = new Date();
    const alertIds = await Promise.all([
      insertTestAlert({ fingerprint: "conc-1", level: 12, wazuhTimestamp: now }),
      insertTestAlert({ fingerprint: "conc-2", level: 12, wazuhTimestamp: now }),
      insertTestAlert({ fingerprint: "conc-3", level: 12, wazuhTimestamp: now }),
      insertTestAlert({ fingerprint: "conc-4", level: 12, wazuhTimestamp: now }),
    ]);

    const results = await Promise.all(alertIds.map((id) => correlateAlert(db, id)));

    const createdCount = results.filter((r) => r && r.created).length;
    expect(createdCount).toBe(1);

    const allIncidents = await db.select().from(schema.incidents);
    expect(allIncidents).toHaveLength(1);

    const links = await db.select().from(schema.incidentAlerts);
    expect(links).toHaveLength(4);
  });
});
