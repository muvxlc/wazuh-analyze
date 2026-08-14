import "server-only";

import type { WazuhConfig } from "./types";
import { WazuhError } from "./errors";
import { Agent, fetch as undiciFetch } from "undici";

export interface IndexerSearchParams {
  /** Bounded agent id filter; optional. */
  agentId?: string;
  /** Bounded rule id filter; optional. */
  ruleId?: string;
  /** Bounded wazuh_event_id exact filter; optional. */
  eventId?: string;
  /** ISO-8601 timestamp start filter (inclusive); optional. */
  from?: string;
  /** ISO-8601 timestamp end filter (inclusive); optional. */
  to?: string;
  /** Result size, clamped to [1, MAX_LIMIT]. Default 20. */
  size?: number;
}

export interface RawEventRecord {
  id: string;
  index: string;
  agentId?: string;
  ruleId?: string;
  level?: number;
  description?: string;
  status?: string;
  wazuhTimestamp?: string;
  ingestedAt?: string;
  /** Pre-normalized highlights extracted from matching fields, not raw _source. */
  highlights?: Record<string, string>;
}

export interface IndexerSearchResponse {
  events: RawEventRecord[];
  total: number;
}

const MAX_STRING_LENGTH = 200;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function boundedString(value: unknown, maxLength = MAX_STRING_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function boundedNumber(value: unknown, min = 1, max = MAX_LIMIT): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  return Math.min(Math.max(value, min), max);
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function recordObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = boundedString(value);
    if (result) return result;
  }
  return undefined;
}

function isValidAgentField(value: unknown): boolean {
  return (typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value as string))
    || (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0);
}

function normalizeEvent(hit: Record<string, unknown>): RawEventRecord {
  const source = recordObject(hit._source);
  const rawId = String(hit._id ?? "").slice(0, MAX_STRING_LENGTH);
  const id = rawId || crypto.randomUUID();
  const fields: Record<string, unknown> = {};
  const knownFields = [
    "agent_id", "agent_name", "rule_id", "level", "description", "status",
    "wazuh_programming_language", "full_log", "formatted_message",
    "host_name", "srcip", "dstip",
  ] as const;
  for (const key of knownFields) {
    const val = source[key];
    if (isValidAgentField(val) && typeof val === "string") {
      fields[key] = val;
    }
  }
  // ponytail: expand normalization when index mapping is confirmed per-cluster.
  const event: RawEventRecord = {
    id,
    index: String(hit._index ?? "").slice(0, MAX_STRING_LENGTH),
    agentId: boundedString(fields["agent_id"]),
    ruleId: boundedString(fields["rule_id"]),
    level: typeof source.level === "number" && Number.isFinite(source.level) ? Math.trunc(source.level) : undefined,
    description: boundedString(source.description),
    status: boundedString(source.status),
    wazuhTimestamp: boundedString(source["@timestamp"] ?? source.wazuh_timestamp),
    ingestedAt: boundedString(source.ingested_at),
  };
  const highlight: Record<string, string> = {};
  for (const key of knownFields) {
    const val = source[key];
    if (typeof val === "string" && val.trim()) {
      highlight[key] = val.trim().slice(0, MAX_STRING_LENGTH);
    }
  }
  if (Object.keys(highlight).length > 0) {
    event.highlights = highlight;
  }
  return event;
}

export function parseSearchParams(query: URLSearchParams): IndexerSearchParams {
  const params: IndexerSearchParams = {};
  const agentId = boundedString(query.get("agentId"));
  if (agentId) params.agentId = agentId;
  const ruleId = boundedString(query.get("ruleId"));
  if (ruleId) params.ruleId = ruleId;
  const eventId = boundedString(query.get("eventId"));
  if (eventId) params.eventId = eventId;
  const from = boundedString(query.get("from"));
  if (from) {
    const date = parseDate(from);
    if (date) params.from = date.toISOString();
  }
  const to = boundedString(query.get("to"));
  if (to) {
    const date = parseDate(to);
    if (date) params.to = date.toISOString();
  }
  const rawSize = query.get("size");
  if (rawSize !== null) {
    const size = boundedNumber(Number(rawSize), 1, MAX_LIMIT);
    if (size !== undefined) params.size = size;
  }
  return params;
}

export async function searchIndexerEvents(
  config: WazuhConfig,
  params: IndexerSearchParams,
  fetchFn: typeof undiciFetch = undiciFetch as unknown as typeof undiciFetch,
): Promise<IndexerSearchResponse> {
  const idx = config.indexer;
  if (!idx) return { events: [], total: 0 };

  const agentId = boundedString(params.agentId);
  const ruleId = boundedString(params.ruleId);
  const eventId = boundedString(params.eventId);
  const from = parseDate(params.from);
  const to = parseDate(params.to);
  const size = boundedNumber(params.size, 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

  const url = new URL("wazuh-alerts-*/_search", idx.url);
  const headers = {
    "Content-Type": "application/json",
    authorization: `Basic ${Buffer.from(`${idx.username}:${idx.password}`).toString("base64")}`,
  };

  const mustClauses: Array<Record<string, unknown>> = [];
  if (agentId) mustClauses.push({ term: { "agent.id": agentId } });
  if (ruleId) mustClauses.push({ term: { rule_id: ruleId } });
  if (eventId) mustClauses.push({ term: { _id: eventId } });
  const timeFilter: Record<string, unknown> = {};
  const gteFields: Record<string, string> = {};
  const lteFields: Record<string, string> = {};
  if (from) gteFields["@timestamp"] = from.toISOString();
  if (to) lteFields["@timestamp"] = to.toISOString();
  if (Object.keys(gteFields).length || Object.keys(lteFields).length) {
    timeFilter.gte = Object.values(gteFields).join("|||");
    timeFilter.lte = Object.values(lteFields).join("|||");
  }
  if (Object.keys(timeFilter).length) {
    mustClauses.push({ range: { "@timestamp": timeFilter } });
  }

  const body = {
    query: { bool: { must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }] } },
    sort: [{ "@timestamp": { order: "asc" } }],
    size,
    _source: ["agent.id", "rule_id", "level", "description", "status", "@timestamp", "ingested_at"],
  };

  const indexerCaPath = idx.caPath ?? config.caPath;
  const indexerInsecureTls = idx.allowInsecureTls ?? config.allowInsecureTls;
  const dispatcher = indexerInsecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : indexerCaPath
      ? new Agent({ connect: { ca: indexerCaPath } })
      : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  async function runSearch(bodyPayload: unknown): Promise<any[]> {
    const res = await fetchFn(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
      dispatcher,
    });
    if (!res.ok) {
      throw new WazuhError("wazuh_indexer_error", res.status, `Indexer returned ${res.status}`);
    }
    const data = await res.json() as any;
    return data;
  }

  try {
    const searchResponse: any = await (async () => {
      try {
        return await runSearch(body);
      } catch (err) {
        if (err instanceof WazuhError && err.status === 400) return runSearch(body);
        throw err;
      }
    })();
    const hits: any[] = searchResponse?.hits?.hits || [];
    const totalVal = searchResponse?.hits?.total;
    const total = (typeof totalVal?.value === "number" && totalVal.value >= 0)
      ? totalVal.value
      : hits.length;
    // ponytail: add highlight parsing when Wazuh query mapping is confirmed.
    return {
      events: hits.map((hit: unknown) => normalizeEvent(recordObject(hit))),
      total,
    };
  } catch (err) {
    if (err instanceof WazuhError) throw err;
    throw new WazuhError(
      "wazuh_indexer_error",
      0,
      `Indexer unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
