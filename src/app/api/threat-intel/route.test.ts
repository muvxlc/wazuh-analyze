import { beforeEach, describe, expect, it, vi } from "vitest";


import { AppError } from "../../../server/errors";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.test:55000";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

const mockRows: unknown[] = [];
const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
const mockAuth = vi.fn();
const mockRequirePermission = vi.fn();

vi.mock("../../../server/db/client", () => ({
  createDatabase: () => ({
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => Promise.resolve(mockRows)),
      execute: vi.fn().mockResolvedValue(undefined),
    },
    pool: { end: mockPoolEnd },
  }),
}));

vi.mock("../../../server/config", () => ({
  loadConfig: () => ({
    nodeEnv: "test" as const,
    appUrl: new URL("http://localhost:3000"),
    databaseUrl: process.env.DATABASE_URL!,
  }),
}));

vi.mock("../../../server/auth/authenticate", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock("../../../server/auth/cookies", () => ({
  SESSION_COOKIE: "wazuh_session",
}));

vi.mock("../../../server/authorization/require", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

vi.mock("server-only", () => ({}));

import { GET } from "./route";

function makeReq(query = "") {
  return new Request(`http://localhost:3000/api/threat-intel?${query}`, {
    headers: { cookie: "wazuh_session=abc" },
  });
}

describe("GET /api/threat-intel", () => {
  const defaultAuth = {
    id: "u1",
    role: "admin" as const,
    permissions: new Set(["ti.read"]),
  };

  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue(defaultAuth);
    mockRequirePermission.mockReset().mockReturnValue(undefined);
    mockPoolEnd.mockReset().mockResolvedValue(undefined);
    mockRows.length = 0;
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockRejectedValueOnce(new AppError("unauthenticated", 401));
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 without ti.read permission", async () => {
    mockRequirePermission.mockImplementationOnce(() => {
      throw new AppError("forbidden", 403);
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it("defaults limit to 50, no cursor, hasMore=false on empty", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.limit).toBe(50);
    expect(body.data.cursor).toBeNull();
    expect(body.data.hasMore).toBe(false);
    expect(body.data.indicators).toHaveLength(0);
  });

  it("defaults limit to 50 with single row, hasMore=false", async () => {
    mockRows.push({
      indicator: "1.2.3.4", type: "ip", abuseScore: 80,
      abuseCategory: "malware", pulseCount: 2, sources: ["otx"],
      fetchedAt: "2026-01-01T00:00:00Z", ttlDays: 30, expired: false,
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.limit).toBe(50);
    expect(body.data.cursor).toBeNull();
    expect(body.data.hasMore).toBe(false);
    expect(body.data.indicators).toHaveLength(1);
  });

  it("returns hasMore=true and cursor when limit+1 rows returned", async () => {
    mockRows.push(...Array.from({ length: 51 }, (_, i) => ({
      indicator: `ip-${i}`, type: "ip", abuseScore: 100 - i,
      abuseCategory: null, pulseCount: null, sources: [],
      fetchedAt: new Date(Date.now() - i * 60000), ttlDays: 30, expired: false,
    })));
    const res = await GET(makeReq("limit=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.indicators).toHaveLength(50);
    expect(body.data.hasMore).toBe(true);
    expect(body.data.cursor).toBeTruthy();
    expect(body.data.cursor).toContain("_");
  });

  it("returns hasMore=false and null cursor on exact limit rows", async () => {
    mockRows.push(...Array.from({ length: 20 }, (_, i) => ({
      indicator: `ip-${i}`, type: "ip", abuseScore: 50 + i,
      abuseCategory: null, pulseCount: null, sources: [],
      fetchedAt: new Date(Date.now()).toISOString(), ttlDays: 30, expired: false,
    })));
    const res = await GET(makeReq("limit=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.indicators).toHaveLength(20);
    expect(body.data.hasMore).toBe(false);
    expect(body.data.cursor).toBeNull();
  });

  it("passes sort param through to response", async () => {
    const res = await GET(makeReq("sort=newest"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sort).toBe("newest");
  });

  it("rejects invalid sort with 400", async () => {
    const res = await GET(makeReq("sort=bogus"));
    expect(res.status).toBe(400);
  });

  it("clamps limit=0 to 1", async () => {
    const res = await GET(makeReq("limit=0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.limit).toBe(1);
  });

  it("enforces MAX_LIMIT=200 cap", async () => {
    const res = await GET(makeReq("limit=500"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.limit).toBe(200);
  });

  it("applies type filter when type=ip", async () => {
    mockRows.push({
      indicator: "8.8.8.8", type: "ip", abuseScore: 10,
      abuseCategory: null, pulseCount: null, sources: [],
      fetchedAt: new Date().toISOString(), ttlDays: 30, expired: false,
    });
    const res = await GET(makeReq("type=ip"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.type).toBe("ip");
    expect(body.data.indicators).toHaveLength(1);
  });

  it("applies query filter when q=evil", async () => {
    mockRows.push({
      indicator: "evil.com", type: "domain", abuseScore: 90,
      abuseCategory: "phishing", pulseCount: null, sources: ["otx"],
      fetchedAt: new Date().toISOString(), ttlDays: 30, expired: false,
    });
    const res = await GET(makeReq("q=evil"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.query).toBe("evil");
    expect(body.data.indicators).toHaveLength(1);
  });
});
