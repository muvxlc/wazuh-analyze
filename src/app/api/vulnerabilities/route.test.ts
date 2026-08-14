import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.test:55000";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

const mockAuthenticateRequest = vi.fn();
const mockRequirePermission = vi.fn();

vi.mock("../../../server/db/client", () => ({
  createDatabase: () => ({ db: {}, pool: { end: () => Promise.resolve() } }),
}));
vi.mock("../../../server/config", () => ({
  loadConfig: () => ({
    nodeEnv: "test" as const,
    appUrl: new URL("http://localhost:3000"),
    databaseUrl: process.env.DATABASE_URL!,
    settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY!,
    wazuh: { apiUrl: new URL("https://wazuh.test:55000"), username: "u", password: "p", caPath: null, allowInsecureTls: false, indexer: { url: new URL("http://localhost:9200"), username: "u", password: "p", caPath: null, allowInsecureTls: false } },
  }),
}));
vi.mock("../../../server/auth/authenticate", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));
vi.mock("../../../server/auth/cookies", () => ({ SESSION_COOKIE: "wazuh_session" }));
vi.mock("../../../server/settings/service", () => ({
  resolveEffectiveConfig: vi.fn().mockResolvedValue({
    wazuh: { apiUrl: new URL("https://wazuh.test:55000"), username: "u", password: "p", caPath: null, allowInsecureTls: false, indexer: { url: new URL("http://localhost:9200"), username: "u", password: "p", caPath: null, allowInsecureTls: false } },
  }),
}));
vi.mock("../../../server/wazuh/adapter", () => ({
  createWazuhClient: vi.fn().mockReturnValue({
    listAgents: vi.fn().mockResolvedValue([{ id: "001", name: "a1", status: "active", ip: "1.2.3.4", version: "4.7", lastKeepAlive: null, groups: [] }]),
  }),
}));
vi.mock("../../../server/wazuh/agent-service", () => ({
  getAgentSnapshot: vi.fn().mockResolvedValue({ agents: [{ id: "001", name: "a1", status: "active", ip: "1.2.3.4", version: "4.7", lastKeepAlive: null, groups: [] }], syncedAt: new Date(), stale: false, upstreamErrorCode: null }),
}));
vi.mock("../../../server/wazuh/indexer", () => ({
  fetchAgentVulnerabilities: vi.fn().mockResolvedValue([{ cve: "CVE-2023-1234", sourceId: "src-1", severity: "High", cvss_score: 8.5, status: "VALID" }]),
}));

import { GET } from "./route";

describe("GET /api/vulnerabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({
      id: "u1", role: "admin", permissions: new Set(["vulnerabilities.read", "vulnerabilities.analyze"]),
      email: "t@x", displayName: "T", locale: "en", sessionId: "s1",
    });
    mockRequirePermission.mockImplementation(() => {});
  });

  it("returns vulnerabilities", async () => {
    const req = new Request("http://localhost/api/vulnerabilities", {
      headers: { cookie: "wazuh_session=valid" }
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.vulnerabilities).toHaveLength(1);
    expect(body.data.vulnerabilities[0].cve).toBe("CVE-2023-1234");
    expect(body.data.agents[0].id).toBe("001");
  });

  it("includes sourceId and canAnalyze on each vulnerability", async () => {
    const req = new Request("http://localhost/api/vulnerabilities", {
      headers: { cookie: "wazuh_session=valid" }
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.vulnerabilities[0].sourceId).toBe("src-1");
    expect(body.data.vulnerabilities[0].canAnalyze).toBe(true);
  });

  it("returns 403 when user lacks vulnerabilities.read permission", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({
      id: "u2", role: "user", permissions: new Set(),
      email: "t@x", displayName: "T", locale: "en", sessionId: "s1",
    });
    const req = new Request("http://localhost/api/vulnerabilities", {
      headers: { cookie: "wazuh_session=valid" }
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});
