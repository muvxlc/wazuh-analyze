import "server-only";

import type { WazuhConfig } from "./types";
import { wazuhGet } from "./http-client";
import { WazuhError } from "./errors";

/**
 * In-memory TTL cache for inventory fetchers. Default TTL is 5 minutes.
 * ponytail: upgrade to redis or DB cache with ?nocache invalidation when multi-node scalability or active attack investigation requires real-time purge.
 */
interface CacheItem<T = unknown> {
  value: T | null;
  expiresAt: number;
}
const inventoryCache = new Map<string, CacheItem>();

export function clearInventoryCache(): void {
  inventoryCache.clear();
}

async function getWithCache<T = unknown>(
  key: string,
  fetchFn: () => Promise<T | null>,
  ttlMs = 300_000,
): Promise<T | null> {
  const now = Date.now();
  const cached = inventoryCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T | null;
  }
  const value = await fetchFn();
  inventoryCache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

async function getOrNull(
  config: WazuhConfig,
  path: string,
  options?: { query?: Record<string, string | number>; fetchFn?: typeof fetch },
): Promise<unknown | null> {
  try {
    return await wazuhGet(config, path, options);
  } catch (error) {
    if (error instanceof WazuhError && error.status === 404) return null;
    throw error;
  }
}

function assertValidId(id: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new WazuhError("invalid_id", 400, "Invalid Wazuh resource ID format");
  }
  return encodeURIComponent(id);
}

export type SyscollectorFacet =
  | "processes"
  | "ports"
  | "packages"
  | "services"
  | "users"
  | "groups"
  | "hardware"
  | "hotfixes"
  | "netiface"
  | "netproto"
  | "netaddr"
  | "os";

const ALLOWED_FACETS: Set<SyscollectorFacet> = new Set([
  "processes",
  "ports",
  "packages",
  "services",
  "users",
  "groups",
  "hardware",
  "hotfixes",
  "netiface",
  "netproto",
  "netaddr",
  "os",
]);

export async function fetchAgentSca(
  config: WazuhConfig,
  agentId: string,
  options?: { fetchFn?: typeof fetch },
): Promise<unknown | null> {
  const id = assertValidId(agentId);
  return getWithCache(`sca:${id}`, () =>
    getOrNull(config, `/sca/${id}`, { query: { limit: 20 }, fetchFn: options?.fetchFn }),
  );
}

export async function fetchRootcheck(
  config: WazuhConfig,
  agentId: string,
  options?: { fetchFn?: typeof fetch },
): Promise<unknown | null> {
  const id = assertValidId(agentId);
  return getWithCache(`rootcheck:${id}`, () =>
    getOrNull(config, `/rootcheck/${id}`, { query: { limit: 20 }, fetchFn: options?.fetchFn }),
  );
}

export async function fetchSyscheck(
  config: WazuhConfig,
  agentId: string,
  options?: { fetchFn?: typeof fetch },
): Promise<unknown | null> {
  const id = assertValidId(agentId);
  return getWithCache(`syscheck:${id}`, () =>
    getOrNull(config, `/syscheck/${id}`, { query: { limit: 20 }, fetchFn: options?.fetchFn }),
  );
}

export async function fetchSyscollector(
  config: WazuhConfig,
  agentId: string,
  facet: SyscollectorFacet,
  options?: { fetchFn?: typeof fetch; limit?: number },
): Promise<unknown | null> {
  const id = assertValidId(agentId);
  if (!ALLOWED_FACETS.has(facet)) {
    throw new WazuhError("invalid_facet", 400, `Invalid syscollector facet: ${facet}`);
  }
  return getWithCache(`syscollector:${id}:${facet}`, () =>
    getOrNull(config, `/syscollector/${id}/${facet}`, {
      query: { limit: options?.limit ?? 30 },
      fetchFn: options?.fetchFn,
    }),
  );
}

/** Thin convenience wrappers for primary facets used by enrichment recipes. */
export const fetchProcesses = (c: WazuhConfig, a: string, o?: { fetchFn?: typeof fetch }) =>
  fetchSyscollector(c, a, "processes", o);
export const fetchPorts = (c: WazuhConfig, a: string, o?: { fetchFn?: typeof fetch }) =>
  fetchSyscollector(c, a, "ports", o);
export const fetchPackages = (c: WazuhConfig, a: string, o?: { fetchFn?: typeof fetch }) =>
  fetchSyscollector(c, a, "packages", o);
export const fetchServices = (c: WazuhConfig, a: string, o?: { fetchFn?: typeof fetch }) =>
  fetchSyscollector(c, a, "services", o);

/**
 * Fetches MITRE technique metadata. Note: /mitre/techniques is list-only in 4.14.7.
 */
export function fetchMitreTechnique(
  config: WazuhConfig,
  techniqueId: string,
  options?: { fetchFn?: typeof fetch },
): Promise<unknown | null> {
  const id = assertValidId(techniqueId);
  return getWithCache(`mitre:${id}`, async () => {
    const res = (await getOrNull(config, "/mitre/techniques", {
      query: { limit: 500 },
      fetchFn: options?.fetchFn,
    })) as { data?: { affected_items?: Array<Record<string, unknown>> } } | null;
    if (!res?.data?.affected_items) return null;
    return res.data.affected_items.find((t) => t.id === techniqueId) ?? null;
  });
}

/**
 * Fetches agent health via /manager/status and /agents/summary/status.
 * Special agent '000' and /agents/{id} cause 404 in RBAC/standalone setups, so we rely on summaries.
 */
export async function fetchAgentHealth(
  config: WazuhConfig,
  options?: { fetchFn?: typeof fetch },
): Promise<unknown | null> {
  return getWithCache("health:summary", async () => {
    // Sequential to prevent concurrent auth token fetches on cold cache
    const managerStatus = await getOrNull(config, "/manager/status", {
      fetchFn: options?.fetchFn,
    });
    const agentsSummary = await getOrNull(config, "/agents/summary/status", {
      fetchFn: options?.fetchFn,
    });
    return { manager: managerStatus, agents: agentsSummary };
  });
}
