import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppError } from "../../../server/errors";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

import { GET, PATCH } from "./route";

const mockAuth = vi.fn();
const mockFetchAll = vi.fn();
const mockUpdate = vi.fn();
const mockRevokeSessions = vi.fn();

vi.mock("../../../server/db/client", () => ({
  createDatabase: () => ({
    db: {
      transaction: vi.fn(async (fn: Function) => fn({ delete: vi.fn(), insert: vi.fn(), execute: vi.fn() })),
    },
    pool: { end: vi.fn() },
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

vi.mock("../../../server/role-permissions/service", () => ({
  fetchAllRoleOverrides: (...args: unknown[]) => mockFetchAll(...args),
  updateRolePermissions: (...args: unknown[]) => mockUpdate(...args),
}));

vi.mock("../../../server/auth/session", () => ({
  revokeSessionsByRoleId: (...args: unknown[]) => mockRevokeSessions(...args),
}));

vi.mock("server-only", () => ({}));

function sessionCookie(token: string) {
  return new Request("http://localhost:3000/api/roles", {
    headers: { cookie: `wazuh_session=${token}`, origin: "http://localhost:3000" },
  });
}

describe("Roles route", () => {
  const adminUser = {
    id: "user-1",
    email: "admin@example.com",
    displayName: "Admin",
    role: "super_admin",
    locale: "en" as const,
    permissions: new Set(["roles.read", "roles.manage", "dashboard.read"]),
    sessionId: "sid-1",
  };

  const regularUser = {
    ...adminUser,
    role: "user" as const,
    permissions: new Set(["dashboard.read"]),
  };

  beforeEach(() => {
    mockAuth.mockReset();
    mockFetchAll.mockReset();
    mockUpdate.mockReset();
    mockRevokeSessions.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockRejectedValueOnce(new AppError("unauthenticated", 401));
    const res = await GET(sessionCookie("invalid"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks roles.read", async () => {
    mockAuth.mockResolvedValueOnce(regularUser);
    const res = await GET(sessionCookie("token"));
    expect(res.status).toBe(403);
  });

  it("returns roles with defaults and overrides on GET", async () => {
    mockAuth.mockResolvedValueOnce(adminUser);
    mockFetchAll.mockResolvedValueOnce(
      new Map([
        ["super_admin", []],
        ["admin", [{ permission: "users.manage", effect: "deny" }]],
        ["user", []],
      ]),
    );

    const res = await GET(sessionCookie("token"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.roles).toHaveLength(3);
    expect(json.data.roles.find((r: any) => r.role === "admin")!.overrides).toEqual([
      { permission: "users.manage", effect: "deny" },
    ]);
  });

  it("returns 422 on PATCH with invalid role", async () => {
    mockAuth.mockResolvedValueOnce(adminUser);
    const res = await PATCH(
      new Request("http://localhost:3000/api/roles", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ role: "invalid", overrides: [] }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("returns 403 when PATCH without roles.manage", async () => {
    const noManageUser = {
      ...adminUser,
      permissions: new Set(["dashboard.read"]),
    };
    mockAuth.mockResolvedValueOnce(noManageUser);
    const res = await PATCH(
      new Request("http://localhost:3000/api/roles", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ role: "admin", overrides: [] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects update when roles.manage not present", async () => {
    const noManageUser = {
      ...adminUser,
      permissions: new Set(["dashboard.read"]),
    };
    mockAuth.mockResolvedValueOnce(noManageUser);
    const res = await PATCH(
      new Request("http://localhost:3000/api/roles", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ role: "admin", overrides: [{ permission: "users.manage", effect: "deny" }] }),
      }),
    );
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("succeeds on PATCH with valid data", async () => {
    mockAuth.mockResolvedValueOnce(adminUser);
    mockUpdate.mockResolvedValueOnce(undefined);

    const res = await PATCH(
      new Request("http://localhost:3000/api/roles", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          role: "admin",
          overrides: [{ permission: "users.manage", effect: "deny" }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      adminUser.id,
      expect.objectContaining({ role: "admin" }),
      true,
      expect.anything(),
    );
    expect(mockRevokeSessions).toHaveBeenCalledWith(expect.anything(), "admin");
  });

  it("rejects PATCH targeting super_admin role", async () => {
    mockAuth.mockResolvedValueOnce(adminUser);
    const res = await PATCH(
      new Request("http://localhost:3000/api/roles", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          role: "super_admin",
          overrides: [],
        }),
      }),
    );
    // Zod enum rejects "super_admin" so we get 422
    expect(res.status).toBe(422);
  });
});
