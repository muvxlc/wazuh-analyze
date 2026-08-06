import "server-only";

import { AppError } from "../errors";
import type { Database } from "../db/types";
import type { ActorContext } from "../authorization/permissions";
import type { RequestMetadata } from "../http/request-metadata";
import { writeAuditEvent } from "../audit/audit-service";
import { encryptSecret, decryptSecret } from "./encryption";
import type { SystemSettingKey } from "./types";
import { listAllSettings, upsertSetting } from "./repository";
import type { AppConfig } from "../config";

/** Keys that carry secret material and must never be echoed in plaintext. */
const SECRET_KEYS: ReadonlySet<SystemSettingKey> = new Set<SystemSettingKey>([
  "wazuhPassword",
  "wazuhUsername",
]);

export function isSecretKey(key: SystemSettingKey): boolean {
  return SECRET_KEYS.has(key);
}

export const ALL_SETTING_KEYS: readonly SystemSettingKey[] = [
  "wazuhApiUrl",
  "wazuhUsername",
  "wazuhPassword",
  "wazuhCaPath",
  "wazuhAllowInsecureTls",
  "alertRetentionDays",
  "maintenanceBatchSize",
  "appUrl",
];

export function isKnownSettingKey(key: string): key is SystemSettingKey {
  return (ALL_SETTING_KEYS as string[]).includes(key);
}

type RowMap = Map<string, { value: unknown; updatedByUserId: string | null; updatedAt: Date }>;

async function loadRowMap(db: Database): Promise<RowMap> {
  const rows = await listAllSettings(db);
  return new Map(rows.map((r) => [r.key, r]));
}

/** Decrypt a DB row; on failure fall back to env value and log once. */
function effective(
  envValue: string | undefined,
  dbRow: { value: unknown } | undefined,
  encryptionKey: string,
): { value: string | null; fromDatabase: boolean } {
  if (dbRow && dbRow.value && typeof dbRow.value === "object" && "iv" in (dbRow.value as object)) {
    try {
      return {
        value: decryptSecret(dbRow.value as Parameters<typeof decryptSecret>[0], encryptionKey),
        fromDatabase: true,
      };
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        console.error("settings: failed to decrypt DB row, falling back to env", err);
      }
    }
  }
  return { value: envValue ?? null, fromDatabase: false };
}

/**
 * Resolve the effective AppConfig: DB-stored values override env at every call.
 * Consumers (Wazuh client, LM Studio) call this so DB edits take effect live.
 */
export async function resolveEffectiveConfig(
  db: Database,
  config: AppConfig,
): Promise<AppConfig> {
  const rows = await loadRowMap(db);
  const eff = (key: SystemSettingKey, envValue: string | undefined) =>
    effective(envValue, rows.get(key), config.settingsEncryptionKey);

  const wazuhApiUrl = eff("wazuhApiUrl", config.wazuh.apiUrl.toString());
  const wazuhUsername = eff("wazuhUsername", config.wazuh.username);
  const wazuhPassword = eff("wazuhPassword", config.wazuh.password);
  const wazuhCaPath = eff("wazuhCaPath", config.wazuh.caPath ?? undefined);
  const wazuhAllowInsecure = eff("wazuhAllowInsecureTls", String(config.wazuh.allowInsecureTls));
  const retention = eff("alertRetentionDays", String(config.alertRetentionDays));
  const batch = eff("maintenanceBatchSize", String(config.maintenanceBatchSize));
  const effectiveApiUrl = wazuhApiUrl.value ? new URL(wazuhApiUrl.value) : config.wazuh.apiUrl;
  const effectiveAllowInsecureTls = wazuhAllowInsecure.value === "true";
  if (config.nodeEnv === "production") {
    if (effectiveApiUrl.protocol !== "https:") {
      throw new Error("WAZUH_API_URL must use HTTPS in production");
    }
    if (effectiveAllowInsecureTls) {
      throw new Error("WAZUH_ALLOW_INSECURE_TLS cannot be true in production");
    }
  }

  return {
    ...config,
    alertRetentionDays: retention.value !== null ? Number(retention.value) : config.alertRetentionDays,
    maintenanceBatchSize: batch.value !== null ? Number(batch.value) : config.maintenanceBatchSize,
    wazuh: {
      ...config.wazuh,
      apiUrl: effectiveApiUrl,
      username: wazuhUsername.value ?? config.wazuh.username,
      password: wazuhPassword.value ?? config.wazuh.password,
      caPath: wazuhCaPath.value !== null && wazuhCaPath.value !== "" ? wazuhCaPath.value : null,
      allowInsecureTls: effectiveAllowInsecureTls,
    },
  };
}

export interface SettingsView {
  retentionDays: number;
  maintenanceBatchSize: number;
  nodeEnv: string;
  appUrl: string;
  wazuhApiUrl: string;
  wazuhUsernameSet: boolean;
  wazuhAllowInsecureTls: boolean;
  wazuhPasswordSet: boolean;
  wazuhCaPath: string | null;
  /** Per-key source flags: true = value came from DB row. */
  sources: Partial<Record<SystemSettingKey, boolean>>;
}

/** Safe display view: secrets reduced to booleans, never echoed. */
export async function getDisplayConfig(db: Database, config: AppConfig): Promise<SettingsView> {
  const effective = await resolveEffectiveConfig(db, config);
  const rows = await loadRowMap(db);
  const src = (k: SystemSettingKey) => {
    const row = rows.get(k);
    return !!row && typeof row.value === "object" && row.value !== null && "iv" in row.value;
  };

  return {
    retentionDays: effective.alertRetentionDays,
    maintenanceBatchSize: effective.maintenanceBatchSize,
    nodeEnv: effective.nodeEnv,
    appUrl: effective.appUrl.origin,
    wazuhApiUrl: effective.wazuh.apiUrl.origin,
    wazuhUsernameSet: effective.wazuh.username.length > 0,
    wazuhAllowInsecureTls: effective.wazuh.allowInsecureTls,
    wazuhPasswordSet: effective.wazuh.password.length > 0,
    wazuhCaPath: effective.wazuh.caPath,
    sources: {
      wazuhApiUrl: src("wazuhApiUrl"),
      wazuhUsername: src("wazuhUsername"),
      wazuhPassword: src("wazuhPassword"),
      wazuhCaPath: src("wazuhCaPath"),
      wazuhAllowInsecureTls: src("wazuhAllowInsecureTls"),
      alertRetentionDays: src("alertRetentionDays"),
      maintenanceBatchSize: src("maintenanceBatchSize"),
    },
  };
}

export interface UpdateSettingEntry {
  key: SystemSettingKey;
  value: string | null;
}

export interface UpdateSettingsInput {
  actor: ActorContext;
  metadata: RequestMetadata;
  settings: UpdateSettingEntry[];
  encryptionKey: string;
}

/**
 * Persist settings (AES-256-GCM per key) + audit in one transaction.
 * Returns nothing; callers re-read via getDisplayConfig.
 */
export async function updateSettings(
  db: Database,
  input: UpdateSettingsInput,
): Promise<void> {
  if (input.settings.length === 0) {
    throw new AppError("empty_body", 422);
  }

  await db.transaction(async (tx) => {
    for (const { key, value } of input.settings) {
      const payload = value !== null && value !== "" ? encryptSecret(value, input.encryptionKey) : null;
      await upsertSetting(tx, key, payload, input.actor.userId);
    }

    await writeAuditEvent(tx, {
      actorUserId: input.actor.userId,
      targetType: "system_settings",
      targetId: null,
      action: "settings.update",
      ipAddress: input.metadata.ip,
      userAgent: input.metadata.userAgent,
      requestId: input.metadata.requestId,
      // Log keys only, never secret material.
      detail: { keys: input.settings.map((s) => s.key), count: input.settings.length },
    });
  });
}
