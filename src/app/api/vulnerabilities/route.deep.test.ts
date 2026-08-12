import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.test:55000";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

vi.mock("../../../server/db/client", () => ({
  createDatabase: () => ({ db: {}, pool: { end: () => Promise.resolve() } }),
}));
vi.mock("../../../server/auth/authenticate", () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    id: "u1", role: "admin", permissions: new Set(["vulnerabilities.read"]),
    email: "t@x", displayName: "T", locale: "en", sessionId: "s1",
  }),
}));
vi.mock("../../../server/auth/cookies", () => ({ SESSION_COOKIE: "wazuh_session" }));
vi.mock("../../../server/settings/service", () => ({
  resolveEffectiveConfig: vi.fn(),
}));
vi.mock("../../../server/wazuh/adapter", () => ({
  createWazuhClient: vi.fn().mockReturnValue({ listAgents: vi.fn().mockResolvedValue([]) }),
}));
vi.mock("../../../server/wazuh/agent-service", () => ({
  getAgentSnapshot: vi.fn(),
}));
vi.mock("../../../server/wazuh/indexer", () => ({
  fetchAgentVulnerabilities: vi.fn(),
}));

import { resolveEffectiveConfig } from "../../../server/settings/service";
import { getAgentSnapshot } from "../../../server/wazuh/agent-service";
import { fetchAgentVulnerabilities } from "../../../server/wazuh/indexer";
import type { AppConfig } from "../../../server/config";
import type { VulnRecord } from "../../../server/wazuh/indexer";
import { GET } from "./route";

const request = () => new Request("http://localhost/api/vulnerabilities", { headers: { cookie: "wazuh_session=valid" } });
const agent = (id: string, name: string) => ({ id, name, status: "active", ip: "1.2.3.4", version: "4.7", lastKeepAlive: null, groups: [] });

const baseConfig = {
  nodeEnv: "test" as const,
  databaseUrl: "postgresql://test:test@localhost:5432/test",
  appUrl: new URL("http://localhost:3000"),
  sessionSecret: "a".repeat(32),
  webhookHmacSecret: "a".repeat(32),
  webhookMaxBodyBytes: 1048576,
  webhookReplayWindowSeconds: 300,
  alertRetentionDays: 30,
  maintenanceBatchSize: 100,
  socAutoAnalyze: false,
  socAutoAnalyzeMinLevel: 5,
  settingsEncryptionKey: "k".repeat(32),
};

const withIndexer: AppConfig = {
  ...baseConfig,
  wazuh: {
    apiUrl: new URL("https://wazuh.test:55000"),
    username: "u",
    password: "p",
    caPath: null,
    allowInsecureTls: false,
    indexer: { url: new URL("http://localhost:9200"), username: "u", password: "p" },
  },
};

const withoutIndexer: AppConfig = {
  ...baseConfig,
  wazuh: {
    apiUrl: new URL("https://wazuh.test:55000"),
    username: "u",
    password: "p",
    caPath: null,
    allowInsecureTls: false,
    indexer: null,
  },
};

const v = (cve: string, score?: number): VulnRecord => ({
  cve,
  severity: "High",
  status: "VALID",
  cvss_score: score,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAgentSnapshot).mockResolvedValue({ agents: [agent("001", "a1")], syncedAt: new Date(), stale: false, upstreamErrorCode: null });
  vi.mocked(fetchAgentVulnerabilities).mockResolvedValue([v("CVE-2023-1234", 8.5)]);
  vi.mocked(resolveEffectiveConfig).mockResolvedValue(withIndexer);
});

describe("GET /api/vulnerabilities deep coverage", () => {
  it("sorts vulnerabilities by CVSS descending", async () => {
    vi.mocked(fetchAgentVulnerabilities).mockResolvedValueOnce([v("low", 5), v("high", 9), v("mid", 7)]);
    const body = await (await GET(request())).json();
    expect(body.data.vulnerabilities.map((x: { cvss_score: number }) => x.cvss_score)).toEqual([9, 7, 5]);
  });

  it("sorts null CVSS last as zero", async () => {
    vi.mocked(fetchAgentVulnerabilities).mockResolvedValueOnce([v("null", undefined), v("low", 1), v("high", 8)]);
    const body = await (await GET(request())).json();
    expect(body.data.vulnerabilities.map((x: { cve: string }) => x.cve)).toEqual(["high", "low", "null"]);
  });

  it("reports per-agent indexer failure while returning 200", async () => {
    vi.mocked(getAgentSnapshot).mockResolvedValueOnce({ agents: [agent("001", "a1"), agent("002", "a2")], syncedAt: new Date(), stale: false, upstreamErrorCode: null });
    vi.mocked(fetchAgentVulnerabilities).mockRejectedValueOnce(new Error("indexer down")).mockResolvedValueOnce([v("ok", 4)]);
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.indexerError).toBe(true);
    expect(body.data.vulnerabilities).toEqual([{ ...v("ok", 4), agentId: "002", agentName: "a2" }]);
  });

  it("reports indexer as unconfigured when effective config omits it", async () => {
    vi.mocked(resolveEffectiveConfig).mockResolvedValueOnce(withoutIndexer);
    const body = await (await GET(request())).json();
    expect(body.data.indexerConfigured).toBe(false);
  });

  it("returns empty vulnerabilities for empty agent snapshot", async () => {
    vi.mocked(getAgentSnapshot).mockResolvedValueOnce({ agents: [], syncedAt: new Date(), stale: false, upstreamErrorCode: null });
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.vulnerabilities).toEqual([]);
  });

  it("attaches agent ID and name to every vulnerability", async () => {
    vi.mocked(fetchAgentVulnerabilities).mockResolvedValueOnce([v("CVE-1", 6), v("CVE-2", 2)]);
    const body = await (await GET(request())).json();
    expect(body.data.vulnerabilities).toEqual([
      { ...v("CVE-1", 6), agentId: "001", agentName: "a1" },
      { ...v("CVE-2", 2), agentId: "001", agentName: "a1" },
    ]);
  });

  it("returns empty vulnerabilities when no indexer is configured", async () => {
    vi.mocked(resolveEffectiveConfig).mockResolvedValueOnce(withoutIndexer);
    vi.mocked(getAgentSnapshot).mockResolvedValueOnce({ agents: [agent("001", "a1")], syncedAt: new Date(), stale: false, upstreamErrorCode: null });
    const body = await (await GET(request())).json();
    expect(body.data.vulnerabilities).toEqual([]);
    expect(body.data.indexerConfigured).toBe(false);
    expect(body.data.indexerError).toBe(false);
    expect(fetchAgentVulnerabilities).not.toHaveBeenCalled();
  });

  it("returns empty for agent with no matching indexer docs", async () => {
    vi.mocked(fetchAgentVulnerabilities).mockResolvedValueOnce([]);
    const body = await (await GET(request())).json();
    expect(body.data.vulnerabilities).toEqual([]);
    expect(body.data.indexerError).toBe(false);
  });
});
