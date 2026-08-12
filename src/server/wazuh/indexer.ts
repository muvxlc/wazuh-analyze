import "server-only";

import type { WazuhConfig } from "./types";
import { WazuhError } from "./errors";
import { Agent, fetch as undiciFetch } from "undici";

export interface VulnRecord {
  cve: string;
  title?: string;
  severity: string;
  cvss_score?: number;
  condition?: string;
  status: string;
  published?: string;
}

type IndexerFetch = (
  input: string | URL,
  init?: RequestInit & { dispatcher?: unknown },
) => Promise<Response>;

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

  // ponytail: Wazuh indexer mapping for `agent` varies by version/setup — sometimes
  // `nested` (requires nested query), sometimes plain `object` (nested query 400s).
  // Try nested first (Wazuh default), fall back to flat term on 400.
  const buildBody = (agentClause: Record<string, unknown>) => ({
    query: {
      bool: {
        must: [
          agentClause,
          { term: { "vulnerability.status": "valid" } },
        ],
      },
    },
    sort: [{ "vulnerability.severity": { order: "desc" } }],
    size: limit,
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

  async function runSearch(agentClause: Record<string, unknown>): Promise<any[]> {
    const res = await fetchFn(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(agentClause)),
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

    return hits.map((hit: any) => {
      // Wazuh indexer stores vulnerability fields at the top level of _source,
      // not nested under a `vulnerability` key.
      const v = hit._source || {};
      return {
        cve: v.cve ?? v.vulnerability?.cve ?? "",
        title: v.title ?? v.vulnerability?.title,
        severity: v.severity ?? v.vulnerability?.severity ?? "",
        // Wazuh stores CVSS score directly as `cvss_score` (numeric), with
        // optional fallback to cvss.cvss3.base_score / cvss.cvss2.base_score.
        // Check top-level cvss_score first, then nested cvss objects in both
        // flat and legacy "vulnerability." prefixed shapes.
        cvss_score: typeof v.cvss_score === "number" ? v.cvss_score
          : v.cvss?.cvss3?.base_score ?? v.vulnerability?.cvss?.cvss3?.base_score
          ?? v.cvss?.cvss2?.base_score ?? v.vulnerability?.cvss?.cvss2?.base_score,
        condition: v.condition ?? v.vulnerability?.condition,
        status: v.status ?? v.vulnerability?.status ?? "",
        published: v.published ?? v.vulnerability?.published,
      };
    });
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
