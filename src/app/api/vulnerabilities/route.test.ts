import { describe, expect, it, vi } from "vitest";

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
  fetchAgentVulnerabilities: vi.fn().mockResolvedValue([{ name: "CVE-2023-1234", severity: "High", cvss_score: 8.5 }]),
}));

import { GET } from "./route";

describe("GET /api/vulnerabilities", () => {
  it("returns vulnerabilities", async () => {
    const req = new Request("http://localhost/api/vulnerabilities", {
      headers: { cookie: "wazuh_session=valid" }
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.vulnerabilities).toHaveLength(1);
    expect(body.data.vulnerabilities[0].name).toBe("CVE-2023-1234");
    expect(body.data.agents[0].id).toBe("001");
  });
});
