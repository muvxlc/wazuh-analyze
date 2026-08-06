import "server-only";

import type { WazuhAgent, WazuhClient, WazuhConfig } from "./types";
import { WazuhError } from "./errors";
import { fetchAgents, clearTokenCache } from "./http-client";

interface WazuhApiAgentItem {
  id: string;
  name: string;
  status: string;
  ip?: string;
  version?: string;
  lastKeepAlive?: string;
}

function mapAgent(item: WazuhApiAgentItem): WazuhAgent {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    ip: item.ip ?? "",
    version: item.version ?? "",
    lastKeepAlive: item.lastKeepAlive ?? null,
  };
}

export function createWazuhClient(
  config: WazuhConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): WazuhClient {
  return {
    async listAgents(): Promise<WazuhAgent[]> {
      const body = (await fetchAgents(config, fetchFn)) as {
        data?: { affected_items?: WazuhApiAgentItem[] };
      };

      const items = body?.data?.affected_items;
      if (!Array.isArray(items)) {
        throw new WazuhError(
          "wazuh_unexpected_response",
          500,
          "Unexpected Wazuh response structure",
        );
      }
      return items.map(mapAgent);
    },
  };
}

export { clearTokenCache };
