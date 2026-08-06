import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

import { POST } from "./route";
import { AppError } from "../../../../../server/errors";

const mockAuth = vi.fn();
const mockDelete = vi.fn();
const mockInsert = vi.fn();
const mockRevoke = vi.fn();
const mockCreateSession = vi.fn();

vi.mock("../../../../../server/db/client", () => ({
  createDatabase: () => ({
    db: {
      transaction: vi.fn(async (fn: Function) => fn({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        for: vi.fn().mockResolvedValue([{ id: "target-user", role: "user" }]),
        delete: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    },
    pool: { end: vi.fn() },
  }),
}));

vi.mock("../../../../../server/config", () => ({
  loadConfig: () => ({
    nodeEnv: "test" as const,
    appUrl: new URL("http://localhost:3000"),
    databaseUrl: process.env.DATABASE_URL!,
  }),
}));

vi.mock("../../../../../server/auth/authenticate", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock("../../../../../server/auth/session", () => ({
  revokeSessionsByUserId: (...args: unknown[]) => mockRevoke(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
}));

vi.mock("server-only", () => ({}));

function sessionCookie(token: string) {
  return new Request("http://localhost:3000/api/users/abc/permissions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: `wazuh_session=${token}` },
    body: JSON.stringify({ overrides: [{ permission: "alerts.read", effect: "allow" }] }),
  });
}

const baseUser = {
  id: "actor-1",
  email: "actor@test.com",
  displayName: "Actor",
  role: "admin" as const,
  locale: "en" as const,
  permissions: new Set(["overrides.manage"]),
  sessionId: "sid-1",
};

const superAdminUser = {
  ...baseUser,
  role: "super_admin" as const,
  permissions: new Set(["overrides.manage", "super_admins.manage"]),
};

describe("User permissions route — escalation hardening", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockDelete.mockReset();
    mockInsert.mockReset();
    mockRevoke.mockReset();
    mockCreateSession.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockRejectedValueOnce(new AppError("unauthenticated", 401));
    const res = await POST(sessionCookie("bad"), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when actor lacks overrides.manage", async () => {
    mockAuth.mockResolvedValueOnce({ ...baseUser, permissions: new Set(["dashboard.read"]) });
    const res = await POST(sessionCookie("token"), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(403);
  });

  it("returns 422 when permission is not in the known catalogue", async () => {
    mockAuth.mockResolvedValueOnce(superAdminUser);
    const res = await POST(
      new Request("http://localhost:3000/api/users/abc/permissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "wazuh_session=t" },
        body: JSON.stringify({ overrides: [{ permission: "nonexistent.perm", effect: "allow" }] }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("invalid_permission");
  });

  it("rejects admin granting super_admins.manage on any user", async () => {
    mockAuth.mockResolvedValueOnce(baseUser);
    const res = await POST(
      new Request("http://localhost:3000/api/users/abc/permissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "wazuh_session=t" },
        body: JSON.stringify({ overrides: [{ permission: "super_admins.manage", effect: "allow" }] }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("rejects admin granting overrides.manage on any user", async () => {
    mockAuth.mockResolvedValueOnce(baseUser);
    const res = await POST(
      new Request("http://localhost:3000/api/users/abc/permissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "wazuh_session=t" },
        body: JSON.stringify({ overrides: [{ permission: "overrides.manage", effect: "allow" }] }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(403);
  });

  it("rejects admin granting roles.manage on any user", async () => {
    mockAuth.mockResolvedValueOnce(baseUser);
    const res = await POST(
      new Request("http://localhost:3000/api/users/abc/permissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "wazuh_session=t" },
        body: JSON.stringify({ overrides: [{ permission: "roles.manage", effect: "allow" }] }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(403);
  });

  it("rejects admin granting settings.manage on any user", async () => {
    mockAuth.mockResolvedValueOnce(baseUser);
    const res = await POST(
      new Request("http://localhost:3000/api/users/abc/permissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "wazuh_session=t" },
        body: JSON.stringify({ overrides: [{ permission: "settings.manage", effect: "allow" }] }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(403);
  });

  it("allows super_admin to grant sensitive management permissions", async () => {
    mockAuth.mockResolvedValueOnce(superAdminUser);
    mockCreateSession.mockResolvedValue({ token: "newtoken", sessionId: "sid-2", expiresAt: new Date() });
    const res = await POST(
      new Request("http://localhost:3000/api/users/abc/permissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "wazuh_session=t" },
        body: JSON.stringify({ overrides: [{ permission: "super_admins.manage", effect: "deny" }] }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(200);
  });

  it("allows super_admin to grant roles.manage", async () => {
    mockAuth.mockResolvedValueOnce(superAdminUser);
    mockCreateSession.mockResolvedValue({ token: "newtoken", sessionId: "sid-2", expiresAt: new Date() });
    const res = await POST(
      new Request("http://localhost:3000/api/users/abc/permissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "wazuh_session=t" },
        body: JSON.stringify({ overrides: [{ permission: "roles.manage", effect: "allow" }] }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(200);
  });

  it("allows super_admin to deny sensitive permissions (defense-in-depth)", async () => {
    mockAuth.mockResolvedValueOnce(superAdminUser);
    mockCreateSession.mockResolvedValue({ token: "newtoken", sessionId: "sid-2", expiresAt: new Date() });
    const res = await POST(
      new Request("http://localhost:3000/api/users/abc/permissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "wazuh_session=t" },
        body: JSON.stringify({ overrides: [{ permission: "settings.manage", effect: "deny" }] }),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(200);
  });
});
