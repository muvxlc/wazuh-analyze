import "server-only";

import type { Database } from "../db/types";
import type { HealthStatus, WazuhConfig } from "../wazuh/types";
import { pingIndexer } from "../wazuh/indexer";

/** Liveness: process alive, always ok. */
export function checkLiveness(): HealthStatus {
  return { status: "ok" };
}

/** Readiness: DB reachable. */
export async function checkReadiness(db: Database): Promise<HealthStatus> {
  try {
    // Raw query to check DB connectivity
    await (db as unknown as { execute(sql: unknown): Promise<unknown> }).execute(
      { sql: "SELECT 1", params: [] } as unknown,
    );
    return { status: "ok" };
  } catch {
    return { status: "down", details: { reason: "database_unreachable" } };
  }
}

/** Wazuh health: separate from readiness. */
export async function checkWazuhHealth(
  client: { listAgents(): Promise<unknown[]> },
): Promise<HealthStatus> {
  try {
    await client.listAgents();
    return { status: "ok" };
  } catch {
    return { status: "down", details: { reason: "wazuh_unreachable" } };
  }
}

/** Wazuh Indexer health. */
export async function checkIndexerHealth(
  config: WazuhConfig,
): Promise<HealthStatus> {
  if (!config.indexer) {
    return { status: "ok", details: { reason: "indexer_not_configured" } };
  }
  const ok = await pingIndexer(config);
  return ok ? { status: "ok" } : { status: "down", details: { reason: "indexer_unreachable" } };
}
