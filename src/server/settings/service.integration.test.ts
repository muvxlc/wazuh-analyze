import { describe, expect, it, beforeEach, afterAll } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import type { AppConfig } from "../config";
import type { ActorContext } from "../authorization/permissions";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import {
  getDisplayConfig,
  updateSettings,
  resolveEffectiveConfig,
  isSecretKey,
  isKnownSettingKey,
} from "./service";
import { encryptSecret } from "./encryption";

const ENCRYPTION_KEY = "test-encryption-key-that-is-at-least-32-characters-long";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    databaseUrl: "postgresql://x",
    appUrl: new URL("http://localhost:3000"),
    sessionSecret: "x".repeat(32),
    webhookHmacSecret: "x".repeat(32),
    webhookMaxBodyBytes: 1_048_576,
    webhookReplayWindowSeconds: 300,
    alertRetentionDays: 30,
    maintenanceBatchSize: 500,
    socAutoAnalyze: false,
    socAutoAnalyzeMinLevel: 7,
    socAutoCreateIncident: true,
    socAutoIncidentMinConfidence: 0.85,
    socAutoIncidentRequireCorroboration: true,
    fpMemoryEnabled: false,
    fpMemoryTtlDays: 14,
    fpMemorySeverityFloor: 12,
    wazuh: {
      apiUrl: new URL("https://env-wazuh.example.com:55000"),
      username: "env-user",
      password: "env-pass",
      caPath: null,
      allowInsecureTls: false,
    },
    ti: {
      providers: [],
      abuseipdbKey: null,
      otxKey: null,
      greynoiseKey: null,
      minLevel: 7,
      cacheTtlDays: 86400,
    },
    settingsEncryptionKey: ENCRYPTION_KEY,
    ...overrides,
  };
}

function makeActor(userId: string): ActorContext {
  return {
    userId,
    role: "super_admin" as const,
    permissions: new Set(["settings.manage"]),
  };
}

const METADATA = { requestId: "req-1", ip: "127.0.0.1", userAgent: "test-agent" };

describe("settings service", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;

  let actorUserId: string;

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);

    const [user] = await db
      .insert(schema.users)
      .values({
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
        displayName: "Admin",
        passwordHash: "hash-admin",
        role: "super_admin",
        locale: "en",
        isActive: true,
      })
      .returning({ id: schema.users.id });

    actorUserId = user.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("getDisplayConfig returns env values when DB is empty", async () => {
    const view = await getDisplayConfig(db, makeConfig());
    expect(view.retentionDays).toBe(30);
    expect(view.maintenanceBatchSize).toBe(500);
    expect(view.wazuhApiUrl).toBe("https://env-wazuh.example.com:55000");
    expect(view.wazuhUsernameSet).toBe(true);
    expect(view.wazuhPasswordSet).toBe(true);
    expect(view.sources.wazuhApiUrl).toBeFalsy();
  });

  it("DB value overrides env in resolveEffectiveConfig", async () => {
    const payload = encryptSecret("https://db-wazuh.example.com:55000", ENCRYPTION_KEY);
    await db.insert(schema.systemSettings).values({
      key: "wazuhApiUrl",
      value: payload,
      updatedAt: new Date(),
    });

    const effective = await resolveEffectiveConfig(db, makeConfig());
    expect(effective.wazuh.apiUrl.toString()).toBe("https://db-wazuh.example.com:55000/");
  });

  it("getDisplayConfig marks source as DB when row present", async () => {
    const payload = encryptSecret("https://db-wazuh.example.com:55000", ENCRYPTION_KEY);
    await db.insert(schema.systemSettings).values({
      key: "wazuhApiUrl",
      value: payload,
      updatedAt: new Date(),
    });

    const view = await getDisplayConfig(db, makeConfig());
    expect(view.wazuhApiUrl).toBe("https://db-wazuh.example.com:55000");
    expect(view.sources.wazuhApiUrl).toBe(true);
  });

  it("getDisplayConfig never echoes secret plaintext", async () => {
    const payload = encryptSecret("super-secret-password", ENCRYPTION_KEY);
    await db.insert(schema.systemSettings).values({
      key: "wazuhPassword",
      value: payload,
      updatedAt: new Date(),
    });

    const view = await getDisplayConfig(db, makeConfig());
    expect(view.wazuhPasswordSet).toBe(true);
    // No field carries the plaintext
    const blob = JSON.stringify(view);
    expect(blob).not.toContain("super-secret-password");
  });

  it("updateSettings persists encrypted value and audits", async () => {
    await updateSettings(db, {
      actor: makeActor(actorUserId),
      metadata: METADATA,
      settings: [
        { key: "wazuhApiUrl", value: "https://updated.example.com:55000" },
        { key: "wazuhPassword", value: "new-password" },
      ],
      encryptionKey: ENCRYPTION_KEY,
    });

    const view = await getDisplayConfig(db, makeConfig());
    expect(view.wazuhApiUrl).toBe("https://updated.example.com:55000");
    expect(view.wazuhPasswordSet).toBe(true);
    expect(view.sources.wazuhApiUrl).toBe(true);
    expect(view.sources.wazuhPassword).toBe(true);

    // Stored value is encrypted, not plaintext
    const [row] = await db
      .select({ value: schema.systemSettings.value })
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "wazuhPassword"));
    expect(JSON.stringify(row!.value)).not.toContain("new-password");

    // Audit event written
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "settings.update"));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.detail).toMatchObject({ count: 2, keys: ["wazuhApiUrl", "wazuhPassword"] });
  });

  it("updateSettings with null value falls back to env", async () => {
    await updateSettings(db, {
      actor: makeActor(actorUserId),
      metadata: METADATA,
      settings: [{ key: "wazuhApiUrl", value: "https://db.example.com:55000" }],
      encryptionKey: ENCRYPTION_KEY,
    });

    // Clear it
    await updateSettings(db, {
      actor: makeActor(actorUserId),
      metadata: METADATA,
      settings: [{ key: "wazuhApiUrl", value: null }],
      encryptionKey: ENCRYPTION_KEY,
    });

    const view = await getDisplayConfig(db, makeConfig());
    expect(view.wazuhApiUrl).toBe("https://env-wazuh.example.com:55000");
    expect(view.sources.wazuhApiUrl).toBeFalsy();
  });

  it("updateSettings rejects empty body", async () => {
    await expect(
      updateSettings(db, {
        actor: makeActor(actorUserId),
        metadata: METADATA,
        settings: [],
        encryptionKey: ENCRYPTION_KEY,
      }),
    ).rejects.toMatchObject({ code: "empty_body" });
  });

  it("resolveEffectiveConfig applies numeric overrides", async () => {
    const payload = encryptSecret("7", ENCRYPTION_KEY);
    await db.insert(schema.systemSettings).values({
      key: "alertRetentionDays",
      value: payload,
      updatedAt: new Date(),
    });

    const effective = await resolveEffectiveConfig(db, makeConfig());
    expect(effective.alertRetentionDays).toBe(7);
  });

  it("rejects insecure TLS DB override in production", async () => {
    const payload = encryptSecret("true", ENCRYPTION_KEY);
    await db.insert(schema.systemSettings).values({
      key: "wazuhAllowInsecureTls",
      value: payload,
      updatedAt: new Date(),
    });

    await expect(
      resolveEffectiveConfig(db, { ...makeConfig(), nodeEnv: "production" }),
    ).rejects.toThrow("WAZUH_ALLOW_INSECURE_TLS");
  });

  it("isSecretKey and isKnownSettingKey classify keys", () => {
    expect(isSecretKey("wazuhPassword")).toBe(true);
    expect(isSecretKey("wazuhApiUrl")).toBe(false);
    expect(isKnownSettingKey("wazuhApiUrl")).toBe(true);
    expect(isKnownSettingKey("nonsense")).toBe(false);
  });
});
