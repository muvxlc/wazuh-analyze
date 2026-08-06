import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { normalizeWazuhAlert } from "./normalize";
import { persistAlert } from "./alert-repository";
import type { NormalizedAlertInput } from "./types";

const pool = createTestPool();
const db = drizzle(pool, { schema });

async function insertActor(): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: "alert-test@example.com",
      normalizedEmail: "alert-test@example.com",
      displayName: "Alert Test",
      passwordHash: "hash-test",
      role: "admin",
      locale: "en",
      isActive: true,
    })
    .returning({ id: schema.users.id });
  return user.id!;
}

describe("persistAlert integration", () => {
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

  it("persists normalized alert and returns insert flag", async () => {
    const raw = {
      id: "evt-persist-1",
      timestamp: "2026-08-02T10:00:00Z",
      rule: { level: 5, id: "500001", description: "Persist test", groups: ["test"] },
      agent: { id: "100", name: "agent-one", ip: "10.0.0.1" },
    };
    const normalized = normalizeWazuhAlert(raw);
    const result = await persistAlert(db, normalized);

    expect(result.inserted).toBe(true);
    expect(result.alert.id).toBeDefined();
    expect(result.alert.wazuhEventId).toBe("evt-persist-1");
    expect(result.alert.rawPayload).toEqual(raw);
  });

  it("returns inserted=false for duplicate wazuh event id", async () => {
    const raw = {
      id: "evt-dup-1",
      timestamp: "2026-08-02T10:00:00Z",
      rule: { level: 3, id: "300001", description: "Dup test", groups: [] },
      agent: { id: "200", name: "agent-two" },
    };
    const normalized = normalizeWazuhAlert(raw);
    const first = await persistAlert(db, normalized);
    expect(first.inserted).toBe(true);

    const second = await persistAlert(db, normalized);
    expect(second.inserted).toBe(false);
    expect(second.alert.id).toBe(first.alert.id);
  });

  it("returns inserted=false for duplicate fingerprint", async () => {
    const raw = {
      id: "evt-fp-dup",
      timestamp: "2026-08-02T10:00:00Z",
      rule: { level: 3, id: "300001", description: "FP dup", groups: [] },
      agent: { id: "200", name: "agent-two" },
    };
    const normalized = normalizeWazuhAlert(raw);
    const first = await persistAlert(db, normalized);
    expect(first.inserted).toBe(true);

    // Same fingerprint, different event ID — should still dedup
    const duplicate = { ...normalized, wazuhEventId: "evt-fp-dup-alt" } as NormalizedAlertInput;
    const second = await persistAlert(db, duplicate);
    expect(second.inserted).toBe(false);
    expect(second.alert.id).toBe(first.alert.id);
  });
});
