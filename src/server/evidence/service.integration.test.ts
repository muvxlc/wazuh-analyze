import { beforeEach, describe, expect, it, afterAll } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";
import { createHash } from "node:crypto";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import {
  createEvidenceRecord,
  validateEvidenceRecord,
  deleteEvidenceRecord,
  listEvidenceRecords,
} from "./service";

describe("evidence service", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;
  let userId: string;

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    const [user] = await db
      .insert(schema.users)
      .values({
        email: "evidence-test@example.com",
        normalizedEmail: "evidence-test@example.com",
        displayName: "Test User",
        passwordHash: "hash",
        role: "user",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });

    userId = user.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  const payload = {
    evidenceType: "ioc" as const,
    title: "Suspicious IP",
    content: { ip: "1.2.3.4" },
  };

  it("creates an evidence record scoped to an alert with provenance fields", async () => {
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: "fp-ev1",
        wazuhTimestamp: new Date(),
        ruleDescription: "x",
        level: 5,
        rawPayload: {},
      })
      .returning({ id: schema.alerts.id });

    const row = await createEvidenceRecord(db, {
      ...payload,
      alertId: alert.id,
      provenanceEndpoint: "https://api.threatintel.example.com/ioc",
      eventAt: new Date("2024-01-01T00:00:00Z"),
    });
    expect(row.id).toBeDefined();
    expect(row.alertId).toBe(alert.id);
    expect(row.incidentId).toBeNull();
    expect(row.validated).toBe(false);
    expect(row.validatedAt).toBeNull();
    expect(row.provenanceEndpoint).toBe("https://api.threatintel.example.com/ioc");
    expect(row.eventAt).toEqual(new Date("2024-01-01T00:00:00Z"));
    expect(row.retrievedAt).toBeInstanceOf(Date);
    expect(row.contentHash).toBe(
      createHash("sha256").update(JSON.stringify(payload.content)).digest("hex"),
    );
    expect(row.contentSize).toBe(Buffer.byteLength(JSON.stringify(payload.content), "utf8"));
  });

  it("creates an evidence record scoped to an incident", async () => {
    const [incident] = await db
      .insert(schema.incidents)
      .values({ incidentNumber: "INC-100", title: "x", status: "open" })
      .returning({ id: schema.incidents.id });

    const row = await createEvidenceRecord(db, { ...payload, incidentId: incident.id });
    expect(row.incidentId).toBe(incident.id);
    expect(row.alertId).toBeNull();
    expect(row.provenanceEndpoint).toBeNull();
    expect(row.contentHash).toBeDefined();
    expect(row.contentSize).toBeGreaterThan(0);
  });

  it("throws 400 when neither alertId nor incidentId is provided", async () => {
    await expect(
      createEvidenceRecord(db, { ...payload }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("throws 400 when both alertId and incidentId are provided", async () => {
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: "fp-dual",
        wazuhTimestamp: new Date(),
        ruleDescription: "x",
        level: 5,
        rawPayload: {},
      })
      .returning({ id: schema.alerts.id });
    const [incident] = await db
      .insert(schema.incidents)
      .values({ incidentNumber: "INC-999", title: "x", status: "open" })
      .returning({ id: schema.incidents.id });

    await expect(
      createEvidenceRecord(db, { ...payload, alertId: alert.id, incidentId: incident.id }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("throws 400 when title is missing", async () => {
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: "fp-empty",
        wazuhTimestamp: new Date(),
        ruleDescription: "x",
        level: 5,
        rawPayload: {},
      })
      .returning({ id: schema.alerts.id });

    await expect(
      // @ts-expect-error — intentional invalid input
      createEvidenceRecord(db, { evidenceType: "note", content: {}, alertId: alert.id }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("throws 400 when content exceeds 65536 bytes", async () => {
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: "fp-big",
        wazuhTimestamp: new Date(),
        ruleDescription: "x",
        level: 5,
        rawPayload: {},
      })
      .returning({ id: schema.alerts.id });

    const bigContent = { data: "x".repeat(70_000) };
    await expect(
      createEvidenceRecord(db, { ...payload, alertId: alert.id, content: bigContent }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("throws 404 when alertId does not exist", async () => {
    await expect(
      createEvidenceRecord(db, { ...payload, alertId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("throws 404 when incidentId does not exist", async () => {
    await expect(
      createEvidenceRecord(db, { ...payload, incidentId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("validateEvidenceRecord sets validated=true + validatedByUserId + validatedAt", async () => {
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: "fp-val",
        wazuhTimestamp: new Date(),
        ruleDescription: "x",
        level: 5,
        rawPayload: {},
      })
      .returning({ id: schema.alerts.id });

    const row = await createEvidenceRecord(db, {
      ...payload,
      alertId: alert.id,
      createdByUserId: userId,
    });

    const validated = await validateEvidenceRecord(db, row.id, userId);
    expect(validated.validated).toBe(true);
    expect(validated.validatedByUserId).toBe(userId);
    expect(validated.validatedAt).toBeInstanceOf(Date);
  });

  it("validateEvidenceRecord throws 404 for unknown id", async () => {
    await expect(
      validateEvidenceRecord(db, "00000000-0000-0000-0000-000000000000", userId),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("deleteEvidenceRecord removes the row; throws 404 for unknown id", async () => {
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: "fp-del",
        wazuhTimestamp: new Date(),
        ruleDescription: "x",
        level: 5,
        rawPayload: {},
      })
      .returning({ id: schema.alerts.id });

    const row = await createEvidenceRecord(db, { ...payload, alertId: alert.id });
    await deleteEvidenceRecord(db, row.id);

    const remaining = await listEvidenceRecords(db, { alertId: alert.id });
    expect(remaining).toHaveLength(0);

    await expect(deleteEvidenceRecord(db, row.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("listEvidenceRecords filters by alertId, incidentId, evidenceType, validated", async () => {
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: "fp-list",
        wazuhTimestamp: new Date(),
        ruleDescription: "x",
        level: 5,
        rawPayload: {},
      })
      .returning({ id: schema.alerts.id });

    const [incident] = await db
      .insert(schema.incidents)
      .values({ incidentNumber: "INC-200", title: "x", status: "open" })
      .returning({ id: schema.incidents.id });

    await createEvidenceRecord(db, { ...payload, alertId: alert.id });
    await createEvidenceRecord(db, { ...payload, incidentId: incident.id });
    await createEvidenceRecord(db, {
      evidenceType: "log",
      title: "Log entry",
      content: {},
      alertId: alert.id,
    });

    // Filter by alertId
    const alertOnly = await listEvidenceRecords(db, { alertId: alert.id });
    expect(alertOnly).toHaveLength(2);

    // Filter by incidentId
    const incidentOnly = await listEvidenceRecords(db, { incidentId: incident.id });
    expect(incidentOnly).toHaveLength(1);

    // Filter by evidenceType
    const logs = await listEvidenceRecords(db, { evidenceType: "log" });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.title).toBe("Log entry");

    // Filter by validated=false
    const created = await createEvidenceRecord(db, { ...payload, alertId: alert.id, createdByUserId: userId });
    await validateEvidenceRecord(db, created.id, userId);
    const unvalidated = await listEvidenceRecords(db, { alertId: alert.id, validated: false });
    expect(unvalidated).toHaveLength(2); // two alert records remain unvalidated (log + original)
  });
});
