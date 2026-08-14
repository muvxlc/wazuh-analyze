import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

const mockAuth = vi.fn();
const mockExecute = vi.fn();
const mockGetPgBoss = vi.fn();
const mockRetry = vi.fn();
const mockResume = vi.fn();

vi.mock("../../../../../server/db/client", () => ({
  createDatabase: () => ({ db: { execute: mockExecute }, pool: { end: vi.fn() } }),
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
vi.mock("../../../../../server/daemon/pg-boss", () => ({
  getPgBoss: (...args: unknown[]) => mockGetPgBoss(...args),
}));
vi.mock("server-only", () => ({}));

import { POST } from "./route";

describe("POST /api/queues/jobs/retry-all", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ id: "u-1", role: "admin", permissions: new Set(["queues.manage"]) });
    mockGetPgBoss.mockResolvedValue({ retry: mockRetry, resume: mockResume });
  });

  it("retries failed/expired and resumes cancelled, returns counts", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { id: "j-1", name: "analyze-alert", state: "failed" },
        { id: "j-2", name: "analyze-alert", state: "cancelled" },
      ],
    });
    const res = await POST(
      new Request("http://localhost:3000/api/queues/jobs/retry-all?state=failed", {
        method: "POST",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.matched).toBe(2);
    expect(body.data.retried).toBe(2);
    expect(mockRetry).toHaveBeenCalledWith("analyze-alert", "j-1");
    expect(mockResume).toHaveBeenCalledWith("analyze-alert", "j-2");
  });

  it("continues past per-job failures, counting only successes", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { id: "j-1", name: "analyze-alert", state: "failed" },
        { id: "j-2", name: "analyze-alert", state: "failed" },
      ],
    });
    mockRetry.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    const res = await POST(
      new Request("http://localhost:3000/api/queues/jobs/retry-all", {
        method: "POST",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.retried).toBe(1);
    expect(body.data.matched).toBe(2);
  });
});
