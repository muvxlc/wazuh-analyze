import { beforeEach, describe, expect, it, afterAll } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { isRecentAnalysisForRule } from "./queue";
import { upsertSetting } from "../settings/repository";
import { encryptSecret } from "../settings/encryption";

describe("isRecentAnalysisForRule", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;
  let userId: string;

  const RULE = "533";
  const AGENT = "mac-room";
  const KEY = "test-encryption-key-0123456789abcdef";

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    const [user] = await db
      .insert(schema.users)
      .values({
        email: "cooldown-test@example.com",
        normalizedEmail: "cooldown-test@example.com",
        displayName: "cooldown",
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

  async function insertAlert(ruleId: string, agentId: string | null) {
    const [alert] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: `${ruleId}-${agentId ?? "none"}-${Math.random()}`,
        wazuhTimestamp: new Date(),
        ruleId,
        agentId,
        ruleDescription: "test rule",
        level: 7,
        rawPayload: { test: true },
      })
      .returning({ id: schema.alerts.id });
    return alert.id;
  }

  it("returns false when no prior analysis exists for rule+agent", async () => {
    const alertId = await insertAlert(RULE, AGENT);
    await expect(isRecentAnalysisForRule(db, alertId, KEY)).resolves.toBe(false);
  });

  it("returns true when a recent analysis exists for same rule+agent", async () => {
    const [prior] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: `${RULE}-${AGENT}-prior`,
        wazuhTimestamp: new Date(),
        ruleId: RULE,
        agentId: AGENT,
        ruleDescription: "test rule",
        level: 7,
        rawPayload: { test: true },
      })
      .returning({ id: schema.alerts.id });
    await db.insert(schema.alertAnalyses).values({
      alertId: prior.id,
      provider: "test",
      model: "test",
      verdict: { severity: "medium", confidence: 0.5 },
      createdByUserId: userId,
    });

    const alertId = await insertAlert(RULE, AGENT);
    await expect(isRecentAnalysisForRule(db, alertId, KEY)).resolves.toBe(true);
  });

  it("returns false for a different agent with the same rule", async () => {
    const [prior] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: `${RULE}-mac-office2-prior`,
        wazuhTimestamp: new Date(),
        ruleId: RULE,
        agentId: "mac-office2",
        ruleDescription: "test rule",
        level: 7,
        rawPayload: { test: true },
      })
      .returning({ id: schema.alerts.id });
    await db.insert(schema.alertAnalyses).values({
      alertId: prior.id,
      provider: "test",
      model: "test",
      verdict: { severity: "medium", confidence: 0.5 },
      createdByUserId: userId,
    });

    const alertId = await insertAlert(RULE, AGENT);
    await expect(isRecentAnalysisForRule(db, alertId, KEY)).resolves.toBe(false);
  });

  it("returns false when the cooldown window is zero for the rule", async () => {
    const [prior] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: `${RULE}-${AGENT}-prior-zero`,
        wazuhTimestamp: new Date(),
        ruleId: RULE,
        agentId: AGENT,
        ruleDescription: "test rule",
        level: 7,
        rawPayload: { test: true },
      })
      .returning({ id: schema.alerts.id });
    await db.insert(schema.alertAnalyses).values({
      alertId: prior.id,
      provider: "test",
      model: "test",
      verdict: { severity: "medium", confidence: 0.5 },
      createdByUserId: userId,
    });
    await upsertSetting(db, "analyzeCooldownSeconds", { [RULE]: 0 } as never, null);

    const alertId = await insertAlert(RULE, AGENT);
    await expect(isRecentAnalysisForRule(db, alertId, KEY)).resolves.toBe(false);
  });

  it("reads an encrypted cooldown map (as updateSettings stores it)", async () => {
    const [prior] = await db
      .insert(schema.alerts)
      .values({
        fingerprint: `${RULE}-${AGENT}-prior-enc`,
        wazuhTimestamp: new Date(),
        ruleId: RULE,
        agentId: AGENT,
        ruleDescription: "test rule",
        level: 7,
        rawPayload: { test: true },
      })
      .returning({ id: schema.alerts.id });
    await db.insert(schema.alertAnalyses).values({
      alertId: prior.id,
      provider: "test",
      model: "test",
      verdict: { severity: "medium", confidence: 0.5 },
      createdByUserId: userId,
    });
    await upsertSetting(
      db,
      "analyzeCooldownSeconds",
      encryptSecret(JSON.stringify({ [RULE]: 3600 }), "test-encryption-key-0123456789abcdef") as never,
      null,
    );

    const alertId = await insertAlert(RULE, AGENT);
    await expect(isRecentAnalysisForRule(db, alertId, KEY)).resolves.toBe(true);
  });
});
