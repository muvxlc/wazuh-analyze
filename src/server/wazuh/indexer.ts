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

/** Lightweight connectivity check for Wazuh Indexer. */
export async function pingIndexer(config: WazuhConfig): Promise<boolean> {
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
    const res = await undiciFetch(url.toString(), {
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

  const body = {
    query: {
      bool: {
        must: [
          { term: { "agent.id": agentId } },
          { term: { "vulnerability.status": "VALID" } }
        ]
      }
    },
    sort: [
      { "vulnerability.severity": { order: "desc" } }
    ],
    size: limit,
  };

  const dispatcher = config.allowInsecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : config.caPath
      ? new Agent({ connect: { ca: config.caPath } })
      : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await undiciFetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      dispatcher,
    });

    if (!res.ok) {
      throw new WazuhError("wazuh_indexer_error", res.status, `Indexer returned ${res.status}`);
    }

    const data = await res.json() as any;
    const hits = data?.hits?.hits || [];

    return hits.map((hit: any) => {
      const v = hit._source?.vulnerability || {};
      return {
        cve: v.cve,
        title: v.title,
        severity: v.severity,
        cvss_score: v.cvss?.cvss3?.base_score || v.cvss?.cvss2?.base_score,
        condition: v.condition,
        status: v.status,
        published: v.published,
      };
    });
  } catch (err) {
    console.error(`[Indexer] Fetch failed for agent ${agentId}:`, err);
    return []; // Return empty on fetch failure to prevent AI enrichment crash
  } finally {
    clearTimeout(timer);
  }
}
