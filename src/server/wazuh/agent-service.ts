import "server-only";

import { desc } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Database } from "../db/types";
import type { AgentSnapshot } from "./types";
import { WazuhError } from "./errors";
import { getCachedSnapshot, setCachedSnapshot } from "./agent-cache";

/**
 * Get agent snapshot: try refresh from Wazuh, fall back to prior data on failure.
 * Successful empty list replaces snapshot (not error).
 * Failed refresh returns previous snapshot with stale=true.
 */
export async function getAgentSnapshot(
  db: unknown,
  client: { listAgents(): Promise<{ id: string; name: string; status: string }[]> },
  now: Date = new Date(),
): Promise<AgentSnapshot> {
  const dbTyped = db as Database;
  try {
    const agents = await client.listAgents();
    const snapshot: AgentSnapshot = {
      agents: agents as AgentSnapshot["agents"],
      syncedAt: now,
      stale: false,
      upstreamErrorCode: null,
    };
    setCachedSnapshot(snapshot.agents, now);

    // Fire and forget DB persist. In-memory cache is ready.
    dbTyped.insert(schema.agentSnapshots).values({
      syncedAt: now,
      agents: snapshot.agents,
      createdAt: now,
    }).execute().catch(() => {});

    return snapshot;
  } catch (err) {
    // Return stale data from in-memory cache or DB
    const cached = getCachedSnapshot();
    const errorCode =
      err instanceof WazuhError ? err.code : "wazuh_unavailable";

    if (cached) {
      return {
        agents: cached.agents,
        syncedAt: cached.syncedAt,
        stale: true,
        upstreamErrorCode: errorCode,
      };
    }

    // Try DB fallback
    try {
      const [row] = await dbTyped
        .select()
        .from(schema.agentSnapshots)
        .orderBy(desc(schema.agentSnapshots.syncedAt))
        .limit(1);

      if (row) {
        const agents = row.agents as AgentSnapshot["agents"];
        setCachedSnapshot(agents, row.syncedAt);
        return {
          agents,
          syncedAt: row.syncedAt,
          stale: true,
          upstreamErrorCode: errorCode,
        };
      }
    } catch {
      // DB also unavailable — return empty stale snapshot
    }

    return {
      agents: [],
      syncedAt: now,
      stale: true,
      upstreamErrorCode: errorCode,
    };
  }
}
