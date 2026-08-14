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
  "abuseipdbKey",
  "otxKey",
  "greynoiseKey",
  "wazuhIndexerUsername",
  "wazuhIndexerPassword",
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
  "socAutoAnalyze",
  "socAutoAnalyzeVulnerabilities",
  "socAutoAnalyzeMinLevel",
  "socAutoCreateIncident",
  "socAutoIncidentMinConfidence",
  "socAutoIncidentRequireCorroboration",
  "tiProviders",
  "abuseipdbKey",
  "otxKey",
  "tiMinLevel",
  "tiCacheTtlDays",
  "wazuhIndexerUrl",
  "wazuhIndexerUsername",
  "wazuhIndexerPassword",
  "greynoiseKey",
  "fpMemoryEnabled",
  "fpMemoryTtlDays",
  "fpMemorySeverityFloor",
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
  const wazuhIndexerUrl = eff("wazuhIndexerUrl", config.wazuh.indexer?.url.toString());
  const wazuhIndexerUsername = eff("wazuhIndexerUsername", config.wazuh.indexer?.username);
  const wazuhIndexerPassword = eff("wazuhIndexerPassword", config.wazuh.indexer?.password);
  const retention = eff("alertRetentionDays", String(config.alertRetentionDays));
  const batch = eff("maintenanceBatchSize", String(config.maintenanceBatchSize));
  const socAuto = eff("socAutoAnalyze", String(config.socAutoAnalyze));
  const socAutoVulnerabilities = eff(
    "socAutoAnalyzeVulnerabilities",
    String(config.socAutoAnalyzeVulnerabilities ?? false),
  );
  const socMinLevel = eff("socAutoAnalyzeMinLevel", String(config.socAutoAnalyzeMinLevel));
  const socCreate = eff("socAutoCreateIncident", String(config.socAutoCreateIncident));
  const socMinConf = eff("socAutoIncidentMinConfidence", String(config.socAutoIncidentMinConfidence));
  const socCorrob = eff("socAutoIncidentRequireCorroboration", String(config.socAutoIncidentRequireCorroboration));
  const tiProviders = eff("tiProviders", config.ti ? config.ti.providers.join(",") : "");
  const abuseipdb = eff("abuseipdbKey", config.ti?.abuseipdbKey ?? undefined);
  const otx = eff("otxKey", config.ti?.otxKey ?? undefined);
  const tiMinLevel = eff("tiMinLevel", config.ti ? String(config.ti.minLevel) : undefined);
  const tiCacheTtl = eff("tiCacheTtlDays", config.ti ? String(config.ti.cacheTtlDays) : undefined);
  const greynoise = eff("greynoiseKey", config.ti?.greynoiseKey ?? undefined);
  const fpMemoryEnabled = eff("fpMemoryEnabled", String(config.fpMemoryEnabled));
  const fpMemoryTtlDays = eff("fpMemoryTtlDays", String(config.fpMemoryTtlDays));
  const fpMemorySeverityFloor = eff("fpMemorySeverityFloor", String(config.fpMemorySeverityFloor));
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
    socAutoAnalyze: socAuto.value !== null ? socAuto.value === "true" : config.socAutoAnalyze,
    socAutoAnalyzeVulnerabilities:
      socAutoVulnerabilities.value !== null
        ? socAutoVulnerabilities.value === "true"
        : (config.socAutoAnalyzeVulnerabilities ?? false),
    socAutoAnalyzeMinLevel:
      socMinLevel.value !== null ? Number(socMinLevel.value) : config.socAutoAnalyzeMinLevel,
    socAutoCreateIncident: socCreate.value !== null ? socCreate.value === "true" : config.socAutoCreateIncident,
    socAutoIncidentMinConfidence:
      socMinConf.value !== null ? Number(socMinConf.value) : config.socAutoIncidentMinConfidence,
    socAutoIncidentRequireCorroboration:
      socCorrob.value !== null ? socCorrob.value === "true" : config.socAutoIncidentRequireCorroboration,
    fpMemoryEnabled: fpMemoryEnabled.value !== null ? fpMemoryEnabled.value === "true" : config.fpMemoryEnabled,
    fpMemoryTtlDays: fpMemoryTtlDays.value !== null ? Number(fpMemoryTtlDays.value) : config.fpMemoryTtlDays,
    fpMemorySeverityFloor: fpMemorySeverityFloor.value !== null ? Number(fpMemorySeverityFloor.value) : config.fpMemorySeverityFloor,
    ti: config.ti
      ? {
          providers: tiProviders.value ? tiProviders.value.split(",").map((s) => s.trim()).filter(Boolean) : config.ti.providers,
          abuseipdbKey: abuseipdb.value ?? config.ti.abuseipdbKey,
          otxKey: otx.value ?? config.ti.otxKey,
          greynoiseKey: greynoise.value ?? config.ti.greynoiseKey,
          minLevel: tiMinLevel.value !== null ? Number(tiMinLevel.value) : config.ti.minLevel,
          cacheTtlDays: tiCacheTtl.value !== null ? Number(tiCacheTtl.value) : config.ti.cacheTtlDays,
        }
      : undefined,
    wazuh: {
      ...config.wazuh,
      apiUrl: effectiveApiUrl,
      username: wazuhUsername.value ?? config.wazuh.username,
      password: wazuhPassword.value ?? config.wazuh.password,
      caPath: wazuhCaPath.value !== null && wazuhCaPath.value !== "" ? wazuhCaPath.value : null,
      allowInsecureTls: effectiveAllowInsecureTls,
      indexer: wazuhIndexerUrl.value
        ? {
            url: new URL(wazuhIndexerUrl.value),
            username: wazuhIndexerUsername.value ?? config.wazuh.indexer?.username ?? wazuhUsername.value ?? config.wazuh.username,
            password: wazuhIndexerPassword.value ?? config.wazuh.indexer?.password ?? wazuhPassword.value ?? config.wazuh.password,
            caPath: config.wazuh.indexer?.caPath ?? (wazuhCaPath.value !== null && wazuhCaPath.value !== "" ? wazuhCaPath.value : null),
            allowInsecureTls: config.wazuh.indexer?.allowInsecureTls ?? effectiveAllowInsecureTls,
          }
        : config.wazuh.indexer,
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
  socAutoAnalyze: boolean;
  socAutoAnalyzeVulnerabilities: boolean;
  socAutoAnalyzeMinLevel: number;
  socAutoCreateIncident: boolean;
  socAutoIncidentMinConfidence: number;
  socAutoIncidentRequireCorroboration: boolean;
  tiProviders: string;
  abuseipdbKeySet: boolean;
  otxKeySet: boolean;
  greynoiseKeySet: boolean;
  tiMinLevel: number;
  tiCacheTtlDays: number;
  fpMemoryEnabled: boolean;
  fpMemoryTtlDays: number;
  fpMemorySeverityFloor: number;
  wazuhIndexerUrl: string;
  wazuhIndexerUsernameSet: boolean;
  wazuhIndexerPasswordSet: boolean;
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
    socAutoAnalyze: effective.socAutoAnalyze,
    socAutoAnalyzeVulnerabilities: effective.socAutoAnalyzeVulnerabilities ?? false,
    socAutoAnalyzeMinLevel: effective.socAutoAnalyzeMinLevel,
    socAutoCreateIncident: effective.socAutoCreateIncident,
    socAutoIncidentMinConfidence: effective.socAutoIncidentMinConfidence,
    socAutoIncidentRequireCorroboration: effective.socAutoIncidentRequireCorroboration,
    tiProviders: effective.ti?.providers.join(",") ?? "abuseipdb,otx",
    abuseipdbKeySet: (effective.ti?.abuseipdbKey ?? "").length > 0,
    otxKeySet: (effective.ti?.otxKey ?? "").length > 0,
    greynoiseKeySet: (effective.ti?.greynoiseKey ?? "").length > 0,
    tiMinLevel: effective.ti?.minLevel ?? 7,
    tiCacheTtlDays: effective.ti?.cacheTtlDays ?? 30,
    fpMemoryEnabled: effective.fpMemoryEnabled,
    fpMemoryTtlDays: effective.fpMemoryTtlDays,
    fpMemorySeverityFloor: effective.fpMemorySeverityFloor,
    wazuhIndexerUrl: effective.wazuh.indexer?.url.origin ?? "",
    wazuhIndexerUsernameSet: (effective.wazuh.indexer?.username ?? "").length > 0,
    wazuhIndexerPasswordSet: (effective.wazuh.indexer?.password ?? "").length > 0,
    sources: {
      wazuhApiUrl: src("wazuhApiUrl"),
      wazuhUsername: src("wazuhUsername"),
      wazuhPassword: src("wazuhPassword"),
      wazuhCaPath: src("wazuhCaPath"),
      wazuhAllowInsecureTls: src("wazuhAllowInsecureTls"),
      alertRetentionDays: src("alertRetentionDays"),
      maintenanceBatchSize: src("maintenanceBatchSize"),
      socAutoAnalyze: src("socAutoAnalyze"),
      socAutoAnalyzeVulnerabilities: src("socAutoAnalyzeVulnerabilities"),
      socAutoAnalyzeMinLevel: src("socAutoAnalyzeMinLevel"),
      socAutoCreateIncident: src("socAutoCreateIncident"),
      socAutoIncidentMinConfidence: src("socAutoIncidentMinConfidence"),
      socAutoIncidentRequireCorroboration: src("socAutoIncidentRequireCorroboration"),
      tiProviders: src("tiProviders"),
      abuseipdbKey: src("abuseipdbKey"),
      otxKey: src("otxKey"),
      greynoiseKey: src("greynoiseKey"),
      tiMinLevel: src("tiMinLevel"),
      tiCacheTtlDays: src("tiCacheTtlDays"),
      wazuhIndexerUrl: src("wazuhIndexerUrl"),
      wazuhIndexerUsername: src("wazuhIndexerUsername"),
      wazuhIndexerPassword: src("wazuhIndexerPassword"),
      fpMemoryEnabled: src("fpMemoryEnabled"),
      fpMemoryTtlDays: src("fpMemoryTtlDays"),
      fpMemorySeverityFloor: src("fpMemorySeverityFloor"),
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
