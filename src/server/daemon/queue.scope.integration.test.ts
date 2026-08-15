import { beforeEach, describe, expect, it, afterAll } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import type { AppConfig } from "../config";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { shouldAnalyzeAlert } from "./queue";
import { upsertSetting } from "../settings/repository";
import { encryptSecret } from "../settings/encryption";

describe("shouldAnalyzeAlert", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;
  let userId: string;

  const KEY = "test-encryption-key-0123456789abcdef";
  const config = { settingsEncryptionKey: KEY, socAutoAnalyzeMinLevel: 12 } as AppConfig;

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    const [user] = await db
      .insert(schema.users)
      .values({
        email: "scope-test@example.com",
        normalizedEmail: "scope-test@example.com",
        displayName: "scope",
        passwordHash: "hash",
        role: "user",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });
    userId = user.id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function insertAlert(level = 7) {
    // rule 533 → fallback map T1046 (Network Service Scanning).
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: `533-scope-${Math.random()}`,
        wazuhTimestamp: new Date(),
        ruleId: "533",
        agentId: "scope-agent",
        ruleDescription: "test rule",
        level,
        rawPayload: { test: true },
      })
      .returning({ id: schema.alerts.id });
    return alert.id;
  }

  async function seedScope(scope: { allowTags?: string[]; denyTags?: string[] }) {
    await upsertSetting(db, "analysisTagScope", encryptSecret(JSON.stringify(scope), KEY), null);
  }

  it("skips when a deny tag matches", async () => {
    await seedScope({ denyTags: ["t1046"] });
    const alertId = await insertAlert(12);
    await expect(shouldAnalyzeAlert(db, config, alertId)).resolves.toEqual({
      shouldAnalyze: false,
      reason: "deny-tag",
    });
  });

  it("analyzes when an allow tag matches", async () => {
    await seedScope({ allowTags: ["T1046"] });
    const alertId = await insertAlert(12);
    await expect(shouldAnalyzeAlert(db, config, alertId)).resolves.toEqual({
      shouldAnalyze: true,
      reason: null,
    });
  });

  it("skips low-level alerts when allow list is empty", async () => {
    await seedScope({ allowTags: [], denyTags: [] });
    await upsertSetting(db, "socAutoAnalyzeMinLevel", encryptSecret("12", KEY), null);
    const alertId = await insertAlert(7);
    await expect(shouldAnalyzeAlert(db, config, alertId)).resolves.toEqual({
      shouldAnalyze: false,
      reason: "below-level",
    });
  });

  it("allow match overrides the level gate", async () => {
    await seedScope({ allowTags: ["T1046"] });
    const alertId = await insertAlert(7);
    await expect(shouldAnalyzeAlert(db, config, alertId)).resolves.toEqual({
      shouldAnalyze: true,
      reason: null,
    });
  });

  it("uses level gate only when scope is empty", async () => {
    await seedScope({ allowTags: [], denyTags: [] });
    const alertId = await insertAlert(12);
    await expect(shouldAnalyzeAlert(db, config, alertId)).resolves.toEqual({
      shouldAnalyze: true,
      reason: null,
    });
  });
});
