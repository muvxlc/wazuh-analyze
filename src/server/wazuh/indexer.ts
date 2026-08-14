import "server-only";

import type { WazuhConfig } from "./types";
import { WazuhError } from "./errors";
import { Agent, fetch as undiciFetch } from "undici";

export interface VulnRecord {
  /** Always populated by indexer normalization; optional for legacy callers constructing records. */
  sourceId?: string;
  cve: string;
  title?: string;
  severity: string;
  cvss_score?: number;
  condition?: string;
  status: string;
  published?: string;
  package?: string;
  installedVersion?: string;
  fixedVersion?: string;
  os?: string;
  exposure?: string;
  detection?: string;
}

type IndexerFetch = (
  input: string | URL,
  init?: RequestInit & { dispatcher?: unknown },
) => Promise<Response>;

const MAX_STRING_LENGTH = 512;
const MAX_SOURCE_ID_LENGTH = 256;
const MAX_LIMIT = 100;

function boundedString(value: unknown, maxLength = MAX_STRING_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function boundedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10 ? value : undefined;
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

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const result = boundedNumber(value);
    if (result !== undefined) return result;
  }
  return undefined;
}

function fallbackSourceId(agentId: string, source: Record<string, unknown>, index: unknown): string {
  const vulnerability = recordObject(source.vulnerability);
  const packageValue = recordObject(source.package);
  const nestedPackage = recordObject(vulnerability.package);
  const parts = [
    ["agent", boundedString(agentId, MAX_SOURCE_ID_LENGTH) ?? "unknown"],
    ["cve", firstString(source.cve, vulnerability.cve, vulnerability.id) ?? ""],
    ["package", firstString(
      source.package_name,
      packageValue.name,
      vulnerability.package_name,
      nestedPackage.name,
    ) ?? ""],
    ["installed", firstString(
      source.installed_version,
      source.installedVersion,
      vulnerability.installed_version,
      vulnerability.installedVersion,
      packageValue.version,
      nestedPackage.version,
    ) ?? ""],
    ["os", firstString(source.os, source.os_name, vulnerability.os, vulnerability.os_name) ?? ""],
    ["severity", firstString(source.severity, vulnerability.severity) ?? ""],
    ["title", firstString(source.title, vulnerability.title) ?? ""],
    ["published", firstString(source.published, vulnerability.published, vulnerability.published_at) ?? ""],
    ["fixed", firstString(source.fixed_version, source.fixedVersion, vulnerability.fixed_version, vulnerability.fixedVersion) ?? ""],
    ["exposure", firstString(source.exposure, vulnerability.exposure) ?? ""],
    ["detection", firstString(source.detection, source.detection_method, vulnerability.detection, vulnerability.detection_method) ?? ""],
    ["index", firstString(index) ?? ""],
  ];
  const serialized = parts.map(([key, value]) => `${key}=${value}`).join("|");
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const agentPart = boundedString(agentId, MAX_SOURCE_ID_LENGTH) ?? "unknown";
  return `fallback-${agentPart}-${(hash >>> 0).toString(16).padStart(8, "0")}`.slice(0, MAX_SOURCE_ID_LENGTH);
}

function normalizeVulnerabilityHit(hit: unknown, agentId: string): VulnRecord {
  const hitRecord = recordObject(hit);
  const source = recordObject(hitRecord._source);
  const vulnerability = recordObject(source.vulnerability);
  const packageValue = recordObject(source.package);
  const nestedPackage = recordObject(vulnerability.package);
  const cvss = recordObject(source.cvss);
  const nestedCvss = recordObject(vulnerability.cvss);
  const sourceId = firstString(boundedString(hitRecord._id, MAX_SOURCE_ID_LENGTH))
    ?? fallbackSourceId(agentId, source, hitRecord._index);
  const record: VulnRecord = {
    sourceId,
    cve: firstString(source.cve, vulnerability.cve, vulnerability.id) ?? "",
    severity: firstString(source.severity, vulnerability.severity) ?? "",
    status: firstString(source.status, vulnerability.status) ?? "",
  };
  const optional: Array<[keyof VulnRecord, string | number | undefined]> = [
    ["title", firstString(source.title, vulnerability.title)],
    ["cvss_score", firstNumber(
      source.cvss_score,
      recordObject(cvss.cvss3).base_score,
      recordObject(nestedCvss.cvss3).base_score,
      recordObject(cvss.cvss2).base_score,
      recordObject(nestedCvss.cvss2).base_score,
    )],
    ["condition", firstString(source.condition, vulnerability.condition)],
    ["published", firstString(source.published, vulnerability.published, vulnerability.published_at)],
    ["package", firstString(
      source.package_name,
      packageValue.name,
      vulnerability.package_name,
      nestedPackage.name,
    )],
    ["installedVersion", firstString(
      source.installed_version,
      source.installedVersion,
      vulnerability.installed_version,
      vulnerability.installedVersion,
      packageValue.version,
      nestedPackage.version,
    )],
    ["fixedVersion", firstString(
      source.fixed_version,
      source.fixedVersion,
      vulnerability.fixed_version,
      vulnerability.fixedVersion,
      packageValue.fixed_version,
      packageValue.fixedVersion,
      nestedPackage.fixed_version,
      nestedPackage.fixedVersion,
    )],
    ["os", firstString(
      source.os,
      source.os_name,
      vulnerability.os,
      vulnerability.os_name,
      recordObject(source.host).os,
    )],
    ["exposure", firstString(source.exposure, vulnerability.exposure)],
    ["detection", firstString(
      source.detection,
      source.detection_method,
      vulnerability.detection,
      vulnerability.detection_method,
    )],
  ];
  for (const [key, value] of optional) {
    if (value !== undefined) record[key] = value as never;
  }
  return record;
}

/** Lightweight connectivity check for Wazuh Indexer. */
export async function pingIndexer(
  config: WazuhConfig,
  fetchFn: IndexerFetch = undiciFetch as unknown as IndexerFetch,
): Promise<boolean> {
  if (!config.indexer) return false;
  const url = new URL("/", config.indexer.url);
  const dispatcher = config.allowInsecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : config.caPath
      ? new Agent({ connect: { ca: config.caPath } })
      : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { authorization: `Basic ${Buffer.from(`${config.indexer.username}:${config.indexer.password}`).toString("base64")}` },
      signal: controller.signal,
      dispatcher,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch vulnerabilities from Wazuh indexer directly.
 * Assumes wazuh-states-vulnerabilities-* index.
 */
export async function fetchAgentVulnerabilities(
  config: WazuhConfig,
  agentId: string,
  limit = 20,
  fetchFn: IndexerFetch = undiciFetch as unknown as IndexerFetch,
): Promise<VulnRecord[]> {
  const idx = config.indexer;
  if (!idx) {
    // If no indexer configured, gracefully fallback to empty
    // ponytail: fallback to REST API `/vulnerability` if supported in future Wazuh versions.
    return [];
  }

  const url = new URL(`wazuh-states-vulnerabilities-*/_search`, idx.url);
  const headers = {
    "Content-Type": "application/json",
    authorization: `Basic ${Buffer.from(`${idx.username}:${idx.password}`).toString("base64")}`,
  };

  // ponytail: `agent` mapping differs across Wazuh versions; retry flat query on nested 400.
  const size = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT) : 20;
  const buildBody = (agentClause: Record<string, unknown>, extraMust: Record<string, unknown>[] = [], resultSize = size) => ({
    query: {
      bool: {
        must: [
          agentClause,
          ...extraMust,
          { term: { "vulnerability.status": "valid" } },
        ],
      },
    },
    sort: [{ "vulnerability.severity": { order: "desc" } }],
    size: resultSize,
  });
  const nestedClause = { nested: { path: "agent", query: { term: { "agent.id": agentId } } } };
  const flatClause = { term: { "agent.id": agentId } };

  // Use indexer-specific TLS settings when present; fall back to Wazuh API TLS settings.
  const indexerCaPath = idx.caPath ?? config.caPath;
  const indexerInsecureTls = idx.allowInsecureTls ?? config.allowInsecureTls;
  const dispatcher = indexerInsecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : indexerCaPath
      ? new Agent({ connect: { ca: indexerCaPath } })
      : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  async function runSearch(
    agentClause: Record<string, unknown>,
    extraMust: Record<string, unknown>[] = [],
    resultSize = size,
  ): Promise<any[]> {
    const res = await fetchFn(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(agentClause, extraMust, resultSize)),
      signal: controller.signal,
      dispatcher,
    });
    if (!res.ok) {
      throw new WazuhError("wazuh_indexer_error", res.status, `Indexer returned ${res.status}`);
    }
    const data = await res.json() as any;
    return data?.hits?.hits || [];
  }

  try {
    let hits: any[];
    try {
      hits = await runSearch(nestedClause);
    } catch (err) {
      // nested query against an object-mapped field 400s; retry flat.
      if (err instanceof WazuhError && err.status === 400) {
        hits = await runSearch(flatClause);
      } else {
        throw err;
      }
    }

    return hits.map((hit: unknown) => normalizeVulnerabilityHit(hit, agentId));
  } catch (err) {
    if (err instanceof WazuhError) throw err;
    // Non-Wazuh errors (network/timeout/abort) — surface as a typed indexer error
    // rather than a silent empty list, so callers can distinguish "no data" from
    // "could not reach indexer". AI enrichment callers should catch and ignore.
    throw new WazuhError("wazuh_indexer_error", 0, `Indexer unreachable for agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch one valid vulnerability, scoped to both agent ID and Indexer document ID. */
export async function fetchVulnerabilityById(
  config: WazuhConfig,
  agentId: string,
  sourceId: string,
  fetchFn: IndexerFetch = undiciFetch as unknown as IndexerFetch,
): Promise<VulnRecord | null> {
  const idx = config.indexer;
  if (!idx) return null;

  const normalizedAgentId = boundedString(agentId, MAX_SOURCE_ID_LENGTH);
  const normalizedSourceId = boundedString(sourceId, MAX_SOURCE_ID_LENGTH);
  if (!normalizedAgentId || !normalizedSourceId) return null;

  const url = new URL(`wazuh-states-vulnerabilities-*/_search`, idx.url);
  const headers = {
    "Content-Type": "application/json",
    authorization: `Basic ${Buffer.from(`${idx.username}:${idx.password}`).toString("base64")}`,
  };
  const nestedAgent = { nested: { path: "agent", query: { term: { "agent.id": normalizedAgentId } } } };
  const flatAgent = { term: { "agent.id": normalizedAgentId } };
  const sourceClause = { term: { _id: normalizedSourceId } };
  const body = (agentClause: Record<string, unknown>) => ({
    query: {
      bool: {
        must: [
          agentClause,
          sourceClause,
          { term: { "vulnerability.status": "valid" } },
        ],
      },
    },
    size: 1,
  });

  const indexerCaPath = idx.caPath ?? config.caPath;
  const indexerInsecureTls = idx.allowInsecureTls ?? config.allowInsecureTls;
  const dispatcher = indexerInsecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : indexerCaPath
      ? new Agent({ connect: { ca: indexerCaPath } })
      : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  const run = async (agentClause: Record<string, unknown>) => {
    const res = await fetchFn(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body(agentClause)),
      signal: controller.signal,
      dispatcher,
    });
    if (!res.ok) {
      throw new WazuhError("wazuh_indexer_error", res.status, `Indexer returned ${res.status}`);
    }
    const data = await res.json() as unknown;
    const hits = recordObject(recordObject(data).hits).hits;
    return Array.isArray(hits) ? hits : [];
  };

  try {
    let hits: unknown[];
    try {
      hits = await run(nestedAgent);
    } catch (error) {
      if (error instanceof WazuhError && error.status === 400) {
        hits = await run(flatAgent);
      } else {
        throw error;
      }
    }
    return hits.length > 0 ? normalizeVulnerabilityHit(hits[0], normalizedAgentId) : null;
  } catch (error) {
    if (error instanceof WazuhError) throw error;
    throw new WazuhError(
      "wazuh_indexer_error",
      0,
      `Indexer unreachable for agent ${normalizedAgentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
