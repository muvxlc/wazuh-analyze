/** Wazuh adapter types — server-only boundary enforced by consumer modules. */

import type { AgentTag } from "./agent-tags";

export interface WazuhConfig {
  apiUrl: URL;
  username: string;
  password: string;
  caPath: string | null;
  allowInsecureTls: boolean;
  /** Optional Elasticsearch/OpenSearch (Wazuh indexer) connection for vuln inventory. */
  indexer?: {
    url: URL;
    username: string;
    password: string;
  } | null;
}

export interface WazuhAgent {
  id: string;
  name: string;
  status: string;
  ip: string;
  version: string;
  lastKeepAlive: string | null;
  groups: string[];
}

export interface WazuhClient {
  listAgents(): Promise<WazuhAgent[]>;
}

export interface AgentSnapshot {
  agents: WazuhAgent[];
  syncedAt: Date;
  stale: boolean;
  upstreamErrorCode: string | null;
  /** Attached by the agents API route, not populated by getAgentSnapshot. */
  agentTags?: Record<string, AgentTag[]>;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  details?: Record<string, unknown>;
}
