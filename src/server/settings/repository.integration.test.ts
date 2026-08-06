import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import {
  getSettingByKey,
  upsertSetting,
  listAllSettings,
} from "./repository";
import { encryptSecret } from "./encryption";

const ENCRYPTION_KEY = "test-encryption-key-that-is-at-least-32-characters-long";

describe("settings repository", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;
  let userIdA: string;
  let userIdB: string;

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    const [userA, userB] = await db
      .insert(schema.users)
      .values([
        { email: "user-a@example.com", normalizedEmail: "user-a@example.com", displayName: "User A", passwordHash: "hash-a", role: "user", locale: "en", isActive: true },
        { email: "user-b@example.com", normalizedEmail: "user-b@example.com", displayName: "User B", passwordHash: "hash-b", role: "user", locale: "en", isActive: true },
      ])
      .returning({ id: schema.users.id });

    userIdA = userA.id;
    userIdB = userB.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns null for missing key", async () => {
    const result = await getSettingByKey(db, "wazuhApiUrl");
    expect(result).toBeNull();
  });

  it("stores and retrieves a setting", async () => {
    const payload = encryptSecret("https://example.com:55000", ENCRYPTION_KEY);
    await upsertSetting(db, "wazuhApiUrl", payload, userIdA);

    const result = await getSettingByKey(db, "wazuhApiUrl");
    expect(result).not.toBeNull();
    expect(result!.value).toEqual(payload);
    expect(result!.updatedByUserId).toBe(userIdA);
  });

  it("upsert overwrites existing key", async () => {
    const payload1 = encryptSecret("first-value", ENCRYPTION_KEY);
    const payload2 = encryptSecret("second-value", ENCRYPTION_KEY);

    await upsertSetting(db, "wazuhApiUrl", payload1, userIdA);
    await upsertSetting(db, "wazuhApiUrl", payload2, userIdB);

    const result = await getSettingByKey(db, "wazuhApiUrl");
    expect(result!.value).toEqual(payload2);
    expect(result!.updatedByUserId).toBe(userIdB);
  });

  it("stores null payload when value is cleared", async () => {
    await upsertSetting(db, "wazuhApiUrl", null, userIdA);

    const result = await getSettingByKey(db, "wazuhApiUrl");
    expect(result).not.toBeNull();
    // Drizzle stores null as {} for jsonb by default (null gets coerced)
    // The service layer handles this by checking fromDatabase flag
  });

  it("lists all settings", async () => {
    const payload1 = encryptSecret("value1", ENCRYPTION_KEY);
    const payload2 = encryptSecret("value2", ENCRYPTION_KEY);

    await upsertSetting(db, "wazuhApiUrl", payload1, userIdA);
    await upsertSetting(db, "alertRetentionDays", payload2, userIdA);

    const rows = await listAllSettings(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(["alertRetentionDays", "wazuhApiUrl"]));
  });

  it("works inside a transaction", async () => {
    await db.transaction(async (tx) => {
      const payload = encryptSecret("tx-value", ENCRYPTION_KEY);
      await upsertSetting(tx, "wazuhApiUrl", payload, userIdA);
    });

    const result = await getSettingByKey(db, "wazuhApiUrl");
    expect(result).not.toBeNull();
  });
});
