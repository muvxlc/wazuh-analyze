import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { fetch as undiciFetch } from "undici";
import { AppError } from "../errors";
import type { Database, DatabaseTransaction } from "../db/types";
import * as schema from "../db/schema";
import { encryptSecret, decryptSecret, type EncryptedPayload } from "../settings/encryption";
import { writeAuditEvent } from "../audit/audit-service";
import type { AuditAction } from "../audit/types";
import type { RequestMetadata } from "../http/request-metadata";

export type AiConnectionProvider = "lm_studio" | "openai_compatible";

export interface AiConnectionSafe {
  id: string;
  name: string;
  provider: AiConnectionProvider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  isDefault: boolean;
  apiKeySet: boolean;
  updatedAt: string;
}

export interface ResolvedAiConnection {
  id: string;
  provider: AiConnectionProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

function toSafe(row: typeof schema.aiConnections.$inferSelect): AiConnectionSafe {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    timeoutMs: row.timeoutMs,
    isDefault: row.isDefault,
    apiKeySet: Boolean(row.apiKey),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAiConnections(db: Database): Promise<AiConnectionSafe[]> {
  const rows = await db
    .select()
    .from(schema.aiConnections)
    .orderBy(schema.aiConnections.createdAt);
  return rows.map(toSafe);
}

export async function getDefaultAiConnection(db: Database): Promise<AiConnectionSafe | null> {
  const rows = await db
    .select()
    .from(schema.aiConnections)
    .orderBy(schema.aiConnections.createdAt)
    .limit(1);
  if (rows.length === 0) return null;
  const explicit = rows.find((r) => r.isDefault) ?? rows[0];
  return toSafe(explicit);
}

export async function resolveAiConnection(
  db: Database,
  id: string | null,
  encryptionKey: string,
): Promise<ResolvedAiConnection> {
  const rows = await db
    .select()
    .from(schema.aiConnections)
    .orderBy(schema.aiConnections.createdAt);
  if (rows.length === 0) {
    throw new AppError("ai_connection_missing", 422);
  }
  const target = id
    ? rows.find((r) => r.id === id)
    : rows.find((r) => r.isDefault) ?? rows[0];
  if (!target) {
    throw new AppError("ai_connection_not_found", 404);
  }
  let apiKey = "";
  if (target.apiKey) {
    try {
      apiKey = decryptSecret(target.apiKey as EncryptedPayload, encryptionKey);
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        console.error("ai-connections: failed to decrypt api key", err);
      }
    }
  }
  return {
    id: target.id,
    provider: target.provider,
    baseUrl: target.baseUrl,
    model: target.model,
    apiKey,
    timeoutMs: target.timeoutMs,
  };
}

export interface CreateAiConnectionInput {
  name: string;
  provider: AiConnectionProvider;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
  isDefault: boolean;
}

export async function createAiConnection(
  db: Database,
  input: CreateAiConnectionInput,
  actorUserId: string,
  metadata: RequestMetadata,
  encryptionKey: string,
): Promise<AiConnectionSafe> {
  const payload = input.apiKey ? encryptSecret(input.apiKey, encryptionKey) : null;
  const [row] = await db
    .insert(schema.aiConnections)
    .values({
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: payload,
      timeoutMs: input.timeoutMs,
      isDefault: input.isDefault,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    })
    .returning();

  if (input.isDefault && row) {
    await clearOtherDefaults(db, row.id);
  }
  await audit(db, actorUserId, metadata, "ai_connection.create", row!.id, { name: input.name, provider: input.provider });
  return toSafe(row!);
}

export interface UpdateAiConnectionInput {
  name?: string;
  provider?: AiConnectionProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string | null;
  timeoutMs?: number;
  isDefault?: boolean;
}

export async function updateAiConnection(
  db: Database,
  id: string,
  patch: UpdateAiConnectionInput,
  actorUserId: string,
  metadata: RequestMetadata,
  encryptionKey: string,
): Promise<AiConnectionSafe> {
  const [existing] = await db
    .select()
    .from(schema.aiConnections)
    .where(eq(schema.aiConnections.id, id))
    .limit(1);
  if (!existing) throw new AppError("ai_connection_not_found", 404);

  const set: Record<string, unknown> = { updatedByUserId: actorUserId, updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.provider !== undefined) set.provider = patch.provider;
  if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl;
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.timeoutMs !== undefined) set.timeoutMs = patch.timeoutMs;
  if (patch.isDefault !== undefined) set.isDefault = patch.isDefault;
  if (patch.apiKey !== undefined) {
    set.apiKey = patch.apiKey && patch.apiKey.length > 0 ? encryptSecret(patch.apiKey, encryptionKey) : null;
  }

  const [row] = await db
    .update(schema.aiConnections)
    .set(set)
    .where(eq(schema.aiConnections.id, id))
    .returning();

  if (patch.isDefault === true && row) {
    await clearOtherDefaults(db, row.id);
  }
  await audit(db, actorUserId, metadata, "ai_connection.update", id, { fields: Object.keys(patch) });
  return toSafe(row!);
}

export async function deleteAiConnection(
  db: Database,
  id: string,
  actorUserId: string,
  metadata: RequestMetadata,
): Promise<void> {
  const [row] = await db
    .delete(schema.aiConnections)
    .where(eq(schema.aiConnections.id, id))
    .returning({ id: schema.aiConnections.id, wasDefault: schema.aiConnections.isDefault });
  if (!row) throw new AppError("ai_connection_not_found", 404);
  await audit(db, actorUserId, metadata, "ai_connection.delete", id, { wasDefault: row.wasDefault });
}

async function clearOtherDefaults(db: Database | DatabaseTransaction, keepId: string): Promise<void> {
  await db
    .update(schema.aiConnections)
    .set({ isDefault: false })
    .where(and(eq(schema.aiConnections.isDefault, true), ne(schema.aiConnections.id, keepId)))
    .execute();
}

async function audit(
  db: Database,
  actorUserId: string,
  metadata: RequestMetadata,
  action: AuditAction,
  targetId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await writeAuditEvent(db, {
    actorUserId,
    targetType: "ai_connections",
    targetId,
    action,
    ipAddress: metadata.ip,
    userAgent: metadata.userAgent,
    requestId: metadata.requestId,
    detail,
  });
}

// --- Chat provider -------------------------------------------------------

export interface ChatProviderConfig {
  provider: AiConnectionProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export interface ChatProvider {
  chat(systemPrompt: string, input: string, signal?: AbortSignal): Promise<string>;
}

export function createChatProvider(
  config: ChatProviderConfig,
  fetchFn: typeof fetch = undiciFetch as unknown as typeof fetch,
): ChatProvider {
  return config.provider === "openai_compatible"
    ? new OpenAiCompatibleChatProvider(config, fetchFn)
    : new LmStudioChatProvider(config, fetchFn);
}

function buildHeaders(config: ChatProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // ponytail: local LM Studio often needs no key; cloud providers always do.
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchFn(url, { ...init, signal: controller.signal } as RequestInit).finally(() => {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  });
}

function assertBaseValid(baseUrl: string): URL {
  try {
    return new URL(baseUrl);
  } catch {
    throw new AppError("ai_connection_invalid_url", 422);
  }
}

function textContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const parts = value.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (typeof part === "object" && part !== null) {
      const p = part as { text?: unknown; content?: unknown };
      return [p.text, p.content].filter((item): item is string => typeof item === "string");
    }
    return [];
  });
  return parts.length > 0 ? parts.join("") : null;
}

function extractText(response: unknown): string {
  const value = response as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
    output?: Array<{ type?: string; content?: unknown }>;
    response?: unknown;
    text?: unknown;
  } | null;
  const choice = value?.choices?.[0];
  const content = textContent(choice?.message?.content) ?? textContent(choice?.text);
  if (content) return content;
  const native = value?.output?.find((item) => item.type === "message") ?? value?.output?.[0];
  const nativeContent = textContent(native?.content);
  if (nativeContent) return nativeContent;
  const fallback = textContent(value?.response) ?? textContent(value?.text);
  if (fallback) return fallback;
  throw new AppError("lm_studio_empty_content", 502);
}

class OpenAiCompatibleChatProvider implements ChatProvider {
  constructor(
    private readonly config: ChatProviderConfig,
    private readonly fetchFn: typeof fetch,
  ) {}

  async chat(systemPrompt: string, input: string, signal?: AbortSignal): Promise<string> {
    const base = assertBaseValid(this.config.baseUrl);
    const path = base.pathname.replace(/\/$/, "");
    const url = new URL(`${path}/chat/completions`, base.origin).toString();
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: buildHeaders(this.config),
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input },
          ],
          max_tokens: 4_096,
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
        ...(signal ? { signal } : {}),
      },
      this.config.timeoutMs,
      this.fetchFn,
    );
    if (!res.ok) {
      throw new AppError("ai_chat_request_failed", res.status, { upstreamStatus: res.status });
    }
    return extractText(await res.json());
  }
}

class LmStudioChatProvider implements ChatProvider {
  constructor(
    private readonly config: ChatProviderConfig,
    private readonly fetchFn: typeof fetch,
  ) {}

  async chat(systemPrompt: string, input: string, signal?: AbortSignal): Promise<string> {
    const base = assertBaseValid(this.config.baseUrl);
    const path = base.pathname.replace(/\/$/, "");
    const url = new URL(`${path}/api/v1/chat`, base.origin).toString();
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: buildHeaders(this.config),
        body: JSON.stringify({ model: this.config.model, system_prompt: systemPrompt, input }),
        ...(signal ? { signal } : {}),
      },
      this.config.timeoutMs,
      this.fetchFn,
    );
    if (!res.ok) {
      throw new AppError("ai_chat_request_failed", res.status, { upstreamStatus: res.status });
    }
    return extractText(await res.json());
  }
}
