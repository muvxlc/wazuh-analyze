import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { normalizeWazuhAlert } from "./normalize";
import { persistAlert } from "./alert-repository";
import { transitionAlert } from "./workflow";
import { makeActor } from "./query";

const pool = createTestPool();
const db = drizzle(pool, { schema });

async function insertActor(): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: "workflow-test@example.com",
      normalizedEmail: "workflow-test@example.com",
      displayName: "Workflow Test",
      passwordHash: "hash-test",
      role: "admin",
      locale: "en",
      isActive: true,
    })
    .returning({ id: schema.users.id });
  return user.id!;
}

async function seedAlert(): Promise<string> {
  const raw = {
    id: "evt-workflow-1",
    timestamp: "2026-08-02T10:00:00Z",
    rule: { level: 5, id: "500001", description: "Workflow test", groups: [] },
    agent: { id: "300", name: "host-x" },
  };
  const normalized = normalizeWazuhAlert(raw);
  const result = await persistAlert(db, normalized);
  return result.alert.id;
}

describe("transitionAlert integration", () => {
  let actorId: string;

  beforeAll(async () => {
    actorId = await insertActor();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
    actorId = await insertActor();
  });

  it("transitions alert from open to acknowledged", async () => {
    const alertId = await seedAlert();
    const actor = makeActor(actorId, "admin");
    const metadata = { requestId: "req-1", ip: "127.0.0.1", userAgent: "test" };

    const result = await transitionAlert(db, actor, { alertId, to: "acknowledged" }, metadata);
    expect(result.status).toBe("acknowledged");
    expect(result.acknowledgedAt).toBeDefined();
    expect(result.acknowledgedByUserId).toBe(actorId);
  });

  it("is idempotent: double acknowledge produces only one alert_event", async () => {
    const alertId = await seedAlert();
    const actor = makeActor(actorId, "admin");
    const metadata = { requestId: "req-1", ip: "127.0.0.1", userAgent: "test" };

    await transitionAlert(db, actor, { alertId, to: "acknowledged" }, metadata);
    await transitionAlert(db, actor, { alertId, to: "acknowledged" }, metadata);

    const events = await db
      .select()
      .from(schema.alertEvents)
      .where(eq(schema.alertEvents.alertId, alertId));
    expect(events).toHaveLength(1);
  });

  it("transitions alert from open to resolved", async () => {
    const alertId = await seedAlert();
    const actor = makeActor(actorId, "admin");
    const metadata = { requestId: "req-2", ip: "127.0.0.1", userAgent: "test" };

    const result = await transitionAlert(db, actor, { alertId, to: "resolved" }, metadata);
    expect(result.status).toBe("resolved");
    expect(result.resolvedAt).toBeDefined();
    expect(result.resolvedByUserId).toBe(actorId);
  });

  it("writes both alert_event and audit_event in one transaction", async () => {
    const alertId = await seedAlert();
    const actor = makeActor(actorId, "admin");
    const metadata = { requestId: "req-3", ip: "127.0.0.1", userAgent: "test" };

    await transitionAlert(db, actor, { alertId, to: "acknowledged" }, metadata);

    const alertEvent = await db
      .select()
      .from(schema.alertEvents)
      .where(eq(schema.alertEvents.alertId, alertId));
    expect(alertEvent).toHaveLength(1);

    const auditEvent = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.targetId, alertId));
    expect(auditEvent).toHaveLength(1);
    expect(auditEvent[0]!.action).toBe("alert.acknowledge");
  });

  it("returns alert detail with timeline", async () => {
    const alertId = await seedAlert();
    const actor = makeActor(actorId, "admin");
    const metadata = { requestId: "req-4", ip: "127.0.0.1", userAgent: "test" };

    const result = await transitionAlert(db, actor, { alertId, to: "acknowledged" }, metadata);
    expect(result.timeline).toBeDefined();
    expect(Array.isArray(result.timeline)).toBe(true);
    expect(result.timeline.length).toBeGreaterThan(0);
  });

  it("rejects transition for non-existent alert", async () => {
    const actor = makeActor(actorId, "admin");
    const metadata = { requestId: "req-5", ip: "127.0.0.1", userAgent: "test" };
    await expect(
      transitionAlert(db, actor, { alertId: "00000000-0000-0000-0000-000000000000", to: "acknowledged" }, metadata),
    ).rejects.toThrow();
  });
});
