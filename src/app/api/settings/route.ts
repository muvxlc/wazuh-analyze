import "server-only";

import { z } from "zod";

import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { assertCsrfSafe } from "../../../server/auth/csrf";
import { toErrorResponse } from "../../../server/http/error-response";
import { getRequestMetadata } from "../../../server/http/request-metadata";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import {
  getDisplayConfig,
  updateSettings,
} from "../../../server/settings/service";
import type { SystemSettingKey } from "../../../server/settings/types";

function sessionToken(request: Request): string | null {
  return (
    request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null
  );
}

// Runtime-editable settings. Secrets are write-only (never echoed by GET).
const patchSchema = z
  .object({
    wazuhApiUrl: z.string().url().optional(),
    wazuhUsername: z.string().min(1).max(200).optional(),
    wazuhPassword: z.string().min(1).max(500).optional(),
    wazuhCaPath: z.string().max(1_000).optional(),
    wazuhAllowInsecureTls: z.boolean().optional(),
    alertRetentionDays: z.number().int().positive().max(3_650).optional(),
    maintenanceBatchSize: z.number().int().positive().max(1_000_000).optional(),
    socAutoAnalyze: z.boolean().optional(),
    socAutoAnalyzeVulnerabilities: z.boolean().optional(),
    socAutoAnalyzeMinLevel: z.number().int().min(1).max(15).optional(),
    socAutoCreateIncident: z.boolean().optional(),
    socAutoIncidentMinConfidence: z.number().min(0).max(1).optional(),
    socAutoIncidentRequireCorroboration: z.boolean().optional(),
    fpMemoryEnabled: z.boolean().optional(),
    fpMemoryTtlDays: z.number().int().min(1).max(90).optional(),
    fpMemorySeverityFloor: z.number().int().min(7).max(14).optional(),
    tiProviders: z.string().optional(),
    abuseipdbKey: z.string().max(500).optional(),
    otxKey: z.string().max(500).optional(),
    greynoiseKey: z.string().max(500).optional(),
    tiMinLevel: z.number().int().min(1).max(15).optional(),
    tiCacheTtlDays: z.number().int().min(1).max(365).optional(),
    wazuhIndexerUrl: z.string().url().optional(),
    wazuhIndexerUsername: z.string().min(1).max(200).optional(),
    wazuhIndexerPassword: z.string().min(1).max(500).optional(),
    analyzeCooldownSeconds: z.record(z.string(), z.number().int().min(0).max(86_400)).optional(),
    analysisTagScope: z
      .object({
        allowTags: z.array(z.string()).optional(),
        denyTags: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const BODY_TO_KEY: Record<string, SystemSettingKey> = {
  wazuhApiUrl: "wazuhApiUrl",
  wazuhUsername: "wazuhUsername",
  wazuhPassword: "wazuhPassword",
  wazuhCaPath: "wazuhCaPath",
  wazuhAllowInsecureTls: "wazuhAllowInsecureTls",
  alertRetentionDays: "alertRetentionDays",
  maintenanceBatchSize: "maintenanceBatchSize",
  socAutoAnalyze: "socAutoAnalyze",
  socAutoAnalyzeVulnerabilities: "socAutoAnalyzeVulnerabilities",
  socAutoAnalyzeMinLevel: "socAutoAnalyzeMinLevel",
  socAutoCreateIncident: "socAutoCreateIncident",
  socAutoIncidentMinConfidence: "socAutoIncidentMinConfidence",
  socAutoIncidentRequireCorroboration: "socAutoIncidentRequireCorroboration",
  fpMemoryEnabled: "fpMemoryEnabled",
  fpMemoryTtlDays: "fpMemoryTtlDays",
  fpMemorySeverityFloor: "fpMemorySeverityFloor",
  tiProviders: "tiProviders",
  abuseipdbKey: "abuseipdbKey",
  otxKey: "otxKey",
  greynoiseKey: "greynoiseKey",
  tiMinLevel: "tiMinLevel",
  tiCacheTtlDays: "tiCacheTtlDays",
  wazuhIndexerUrl: "wazuhIndexerUrl",
  wazuhIndexerUsername: "wazuhIndexerUsername",
  wazuhIndexerPassword: "wazuhIndexerPassword",
  analyzeCooldownSeconds: "analyzeCooldownSeconds",
  analysisTagScope: "analysisTagScope",
};

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, sessionToken(request));
    requirePermission(user.permissions, "settings.manage");
    const view = await getDisplayConfig(db, config);
    return Response.json(
      { data: view },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, sessionToken(request));
    requirePermission(user.permissions, "settings.manage");

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: { code: "invalid_input", requestId } },
        { status: 422 },
      );
    }

    const entries = Object.entries(parsed.data).map(([bodyKey, value]) => ({
      key: BODY_TO_KEY[bodyKey]!,
      value:
        value === null || value === undefined
          ? null
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value),
    }));

    if (entries.length === 0) {
      return Response.json(
        { error: { code: "empty_body", requestId } },
        { status: 422 },
      );
    }

    const metadata = getRequestMetadata(request);
    await updateSettings(db, {
      actor: {
        userId: user.id,
        role: user.role,
        permissions: new Set(user.permissions),
      },
      metadata,
      settings: entries,
      encryptionKey: config.settingsEncryptionKey,
    });

    const view = await getDisplayConfig(db, config);
    return Response.json(
      { data: view },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
