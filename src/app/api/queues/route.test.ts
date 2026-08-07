import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppError } from "../../../server/errors";
import { PERMISSIONS } from "../../../server/authorization/permissions";
import {
  QUEUE_ANALYZE_ALERT,
  QUEUE_DISPATCH_NOTIFICATION,
  QUEUE_EXECUTE_ACTION,
  QUEUE_WEEKLY_REPORT,
} from "../../../server/daemon/queue";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

import { GET } from "./route";

const mockAuth = vi.fn();
const mockGetQueues = vi.fn();
const mockGetPgBoss = vi.fn();

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

vi.mock("../../../server/daemon/pg-boss", () => ({
  getPgBoss: (...args: unknown[]) => mockGetPgBoss(...args),
}));

vi.mock("server-only", () => ({}));

function sessionCookie(token: string) {
  return new Request("http://localhost:3000/api/queues", {
    headers: { cookie: `wazuh_session=${token}`, origin: "http://localhost:3000" },
  });
}

describe("Queues route", () => {
  const adminUser = {
    id: "user-1",
    email: "admin@example.com",
    displayName: "Admin",
    role: "super_admin" as const,
    locale: "en" as const,
    permissions: new Set([PERMISSIONS.queuesRead, "dashboard.read"]),
    sessionId: "sid-1",
  };

  const noPermUser = {
    ...adminUser,
    permissions: new Set(["dashboard.read"]),
  };

  beforeEach(() => {
    mockAuth.mockReset();
    mockGetPgBoss.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockRejectedValueOnce(new AppError("unauthenticated", 401));
    const res = await GET(sessionCookie("invalid"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks queues.read", async () => {
    mockAuth.mockResolvedValueOnce(noPermUser);
    const res = await GET(sessionCookie("token"));
    expect(res.status).toBe(403);
    expect(mockGetPgBoss).not.toHaveBeenCalled();
  });

  it("returns queue counts on GET 200", async () => {
    mockAuth.mockResolvedValueOnce(adminUser);
    mockGetPgBoss.mockResolvedValueOnce({
      getQueues: mockGetQueues.mockResolvedValue([
        { name: QUEUE_ANALYZE_ALERT, queuedCount: 3, readyCount: 2, activeCount: 1, failedCount: 0, deferredCount: 0, totalCount: 6 },
        { name: QUEUE_DISPATCH_NOTIFICATION, queuedCount: 1, readyCount: 1, activeCount: 0, failedCount: 1, deferredCount: 0, totalCount: 2 },
        { name: QUEUE_EXECUTE_ACTION, queuedCount: 0, readyCount: 0, activeCount: 0, failedCount: 0, deferredCount: 0, totalCount: 0 },
        { name: QUEUE_WEEKLY_REPORT, queuedCount: 0, readyCount: 0, activeCount: 0, failedCount: 0, deferredCount: 0, totalCount: 0 },
      ]),
    });

    const res = await GET(sessionCookie("token"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.queues[QUEUE_ANALYZE_ALERT]).toEqual({ name: QUEUE_ANALYZE_ALERT, queuedCount: 3, readyCount: 2, activeCount: 1, failedCount: 0, deferredCount: 0, totalCount: 6 });
    expect(json.data.queues[QUEUE_DISPATCH_NOTIFICATION]).toEqual({ name: QUEUE_DISPATCH_NOTIFICATION, queuedCount: 1, readyCount: 1, activeCount: 0, failedCount: 1, deferredCount: 0, totalCount: 2 });
    expect(json.data.queues[QUEUE_EXECUTE_ACTION]).toEqual({ name: QUEUE_EXECUTE_ACTION, queuedCount: 0, readyCount: 0, activeCount: 0, failedCount: 0, deferredCount: 0, totalCount: 0 });
    expect(json.data.queues[QUEUE_WEEKLY_REPORT]).toEqual({ name: QUEUE_WEEKLY_REPORT, queuedCount: 0, readyCount: 0, activeCount: 0, failedCount: 0, deferredCount: 0, totalCount: 0 });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("propagates PgBoss errors as 500", async () => {
    mockAuth.mockResolvedValueOnce(adminUser);
    mockGetPgBoss.mockResolvedValueOnce({
      getQueues: mockGetQueues.mockRejectedValueOnce(new Error("db down")),
    });

    const res = await GET(sessionCookie("token"));
    expect(res.status).toBe(500);
  });
});
