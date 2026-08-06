import "server-only";

import type { WazuhAgent, WazuhClient, WazuhConfig } from "./types";
import { WazuhError } from "./errors";
import { fetchAgents, clearTokenCache } from "./http-client";
import { fetch as undiciFetch } from "undici";

interface WazuhApiAgentItem {
  id: string;
  name: string;
  status: string;
  ip?: string;
  version?: string;
  lastKeepAlive?: string;
  group?: string[];
}

function mapAgent(item: WazuhApiAgentItem): WazuhAgent {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    ip: item.ip ?? "",
    version: item.version ?? "",
    lastKeepAlive: item.lastKeepAlive ?? null,
    groups: Array.isArray(item.group)
      ? item.group.filter((g): g is string => typeof g === "string")
      : [],
  };
}

export function createWazuhClient(
  config: WazuhConfig,
  fetchFn: typeof fetch = undiciFetch as unknown as typeof fetch,
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
