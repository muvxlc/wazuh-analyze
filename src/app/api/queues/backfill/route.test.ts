import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppError } from "../../../../server/errors";
import { PERMISSIONS } from "../../../../server/authorization/permissions";
import { POST } from "./route";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";

const mockAuth = vi.fn();
const mockEnqueue = vi.fn();

vi.mock("../../../../server/db/client", () => ({
  createDatabase: () => ({ db: {}, pool: { end: vi.fn() } }),
}));

vi.mock("../../../../server/config", () => ({
  loadConfig: () => ({ databaseUrl: "postgres://test" }),
}));

vi.mock("../../../../server/auth/authenticate", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock("../../../../server/daemon/backfill", () => ({
  enqueuePendingAlerts: (...args: unknown[]) => mockEnqueue(...args),
}));

describe("Backfill route", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockEnqueue.mockReset();
  });

  const admin = {
    permissions: new Set([PERMISSIONS.queuesManage]),
  };

  it("requires queues.manage permission", async () => {
    mockAuth.mockResolvedValueOnce({ permissions: new Set() });
    const req = new Request("http://test/api/queues/backfill", { method: "POST", headers: { cookie: "wazuh_session=x" } });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("enqueues pending alerts", async () => {
    mockAuth.mockResolvedValueOnce(admin);
    mockEnqueue.mockResolvedValueOnce(42);

    const req = new Request("http://test/api/queues/backfill", {
      method: "POST",
      headers: { cookie: "wazuh_session=x", "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.enqueued).toBe(42);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.anything(), 50);
  });
});
