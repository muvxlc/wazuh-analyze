import { describe, expect, it, vi, beforeEach } from "vitest";

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
  authenticateRequest: vi.fn(),
}));
vi.mock("../../../server/auth/cookies", () => ({ SESSION_COOKIE: "wazuh_session" }));
vi.mock("../../../server/settings/service", () => ({
  resolveEffectiveConfig: vi.fn().mockResolvedValue({
    wazuh: { apiUrl: new URL("https://wazuh.test:55000"), username: "u", password: "p", caPath: null, allowInsecureTls: false },
  }),
}));
vi.mock("../../../server/wazuh/adapter", () => ({
  createWazuhClient: vi.fn().mockReturnValue({}),
}));
vi.mock("../../../server/wazuh/agent-service", () => ({
  getAgentSnapshot: vi.fn(),
}));
vi.mock("../../../server/wazuh/inventory", () => ({
  fetchAgentSca: vi.fn(),
}));

import { authenticateRequest } from "../../../server/auth/authenticate";
import { getAgentSnapshot } from "../../../server/wazuh/agent-service";
import { fetchAgentSca } from "../../../server/wazuh/inventory";
import { GET } from "./route";

describe("GET /api/compliance deep", () => {
  beforeEach(() => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      id: "u1", role: "admin", permissions: new Set(["compliance.read"]),
      email: "t@x", displayName: "T", locale: "en", sessionId: "s1",
    } as any);
  });

  it("aggregates across multiple active agents and respects score floor", async () => {
    vi.mocked(getAgentSnapshot).mockResolvedValueOnce({
      agents: [
        { id: "001", name: "a1", status: "active", ip: "1", version: "4", lastKeepAlive: null, groups: [] },
        { id: "002", name: "a2", status: "active", ip: "2", version: "4", lastKeepAlive: null, groups: [] },
        { id: "003", name: "a3", status: "disconnected", ip: "3", version: "4", lastKeepAlive: null, groups: [] }
      ],
      syncedAt: new Date(), stale: false, upstreamErrorCode: null
    });
    
    vi.mocked(fetchAgentSca)
      .mockResolvedValueOnce({ data: { affected_items: [{ policy_id: "cis", pass: 2, fail: 1, total_checks: 3, score: 70 }] } }) // agent 001
      .mockResolvedValueOnce({ data: { affected_items: [{ policy_id: "cis", pass: 3, fail: 0, total_checks: 3, score: 90 }] } }); // agent 002

    const req = new Request("http://localhost/api/compliance", { headers: { cookie: "wazuh_session=valid" } });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    
    expect(body.data.agentsScanned).toBe(2); // disconnected skipped
    expect(body.data.policies).toHaveLength(1);
    const pol = body.data.policies[0];
    expect(pol.pass).toBe(5);
    expect(pol.fail).toBe(1);
    expect(pol.totalChecks).toBe(6);
    expect(pol.score).toBe(90); // floor highest
    expect(pol.agentCount).toBe(2);
  });

  it("handles null references and empty data safely", async () => {
    vi.mocked(getAgentSnapshot).mockResolvedValueOnce({
      agents: [{ id: "001", name: "a1", status: "active", ip: "1", version: "4", lastKeepAlive: null, groups: [] }],
      syncedAt: new Date(), stale: true, upstreamErrorCode: null
    });
    vi.mocked(fetchAgentSca).mockResolvedValueOnce({ data: { affected_items: [{ policy_id: "pci", references: null }] } });

    const req = new Request("http://localhost/api/compliance", { headers: { cookie: "wazuh_session=valid" } });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    
    expect(body.data.stale).toBe(true);
    expect(body.data.policies[0].references).toBeNull();
  });

  it("returns 403 on permission denied", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      id: "u1", role: "user", permissions: new Set(["other.read"]),
    } as any);

    const req = new Request("http://localhost/api/compliance", { headers: { cookie: "wazuh_session=valid" } });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});
