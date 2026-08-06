/** Wazuh adapter types — server-only boundary enforced by consumer modules. */

export interface WazuhConfig {
  apiUrl: URL;
  username: string;
  password: string;
  caPath: string | null;
  allowInsecureTls: boolean;
}

export interface WazuhAgent {
  id: string;
  name: string;
  status: string;
  ip: string;
  version: string;
  lastKeepAlive: string | null;
}

export interface WazuhClient {
  listAgents(): Promise<WazuhAgent[]>;
}

export interface AgentSnapshot {
  agents: WazuhAgent[];
  syncedAt: Date;
  stale: boolean;
  upstreamErrorCode: string | null;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  details?: Record<string, unknown>;
}
