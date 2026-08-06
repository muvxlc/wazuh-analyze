import "server-only";

import type { AgentSnapshot, WazuhAgent } from "./types";

/**
 * In-memory agent cache. Bounded to one snapshot.
 * ponytail: upgrade to DB-backed cache via agentSnapshots table when multi-instance needed.
 */
interface CacheEntry {
  agents: WazuhAgent[];
  syncedAt: Date;
}

let cache: CacheEntry | null = null;

export function getCachedSnapshot(): CacheEntry | null {
  return cache;
}

export function setCachedSnapshot(agents: WazuhAgent[], syncedAt: Date): void {
  cache = { agents, syncedAt };
}

export function clearCache(): void {
  cache = null;
}
