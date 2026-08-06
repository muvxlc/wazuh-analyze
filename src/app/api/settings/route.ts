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
    lmStudioBaseUrl: z.string().url().optional(),
    lmStudioModel: z.string().min(1).max(200).optional(),
    lmStudioApiKey: z.string().min(1).max(500).optional(),
    lmStudioTimeoutMs: z.number().int().positive().max(300_000).optional(),
    alertRetentionDays: z.number().int().positive().max(3_650).optional(),
    maintenanceBatchSize: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict();

const BODY_TO_KEY: Record<string, SystemSettingKey> = {
  wazuhApiUrl: "wazuhApiUrl",
  wazuhUsername: "wazuhUsername",
  wazuhPassword: "wazuhPassword",
  wazuhCaPath: "wazuhCaPath",
  wazuhAllowInsecureTls: "wazuhAllowInsecureTls",
  lmStudioBaseUrl: "lmStudioBaseUrl",
  lmStudioModel: "lmStudioModel",
  lmStudioApiKey: "lmStudioApiKey",
  lmStudioTimeoutMs: "lmStudioTimeoutMs",
  alertRetentionDays: "alertRetentionDays",
  maintenanceBatchSize: "maintenanceBatchSize",
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
          : typeof value === "boolean"
            ? String(value)
            : typeof value === "number"
              ? String(value)
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
