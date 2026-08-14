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
    id: "u1", role: "admin", permissions: new Set(["compliance.read"]),
    email: "t@x", displayName: "T", locale: "en", sessionId: "s1",
  }),
}));
vi.mock("../../../server/auth/cookies", () => ({ SESSION_COOKIE: "wazuh_session" }));
vi.mock("../../../server/settings/service", () => ({
  resolveEffectiveConfig: vi.fn().mockResolvedValue({
    wazuh: { apiUrl: new URL("https://wazuh.test:55000"), username: "u", password: "p", caPath: null, allowInsecureTls: false },
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
vi.mock("../../../server/wazuh/inventory", () => ({
  fetchAgentSca: vi.fn().mockResolvedValue({ data: { affected_items: [{ policy_id: "cis", name: "CIS", pass: 5, fail: 1, total_checks: 6, score: 83 }] } }),
}));

import { GET } from "./route";

describe("GET /api/compliance", () => {
  it("returns compliance policies", async () => {
    const req = new Request("http://localhost/api/compliance", {
      headers: { cookie: "wazuh_session=valid" }
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.policies).toHaveLength(1);
    expect(body.data.policies[0].policyId).toBe("cis");
    expect(body.data.agentsScanned).toBe(1);
  });
});
