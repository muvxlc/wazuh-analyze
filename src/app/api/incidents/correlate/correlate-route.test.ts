import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

const mockCorrelateAlert = vi.fn();
const mockAuthenticateRequest = vi.fn();

const mockSelect = vi.fn();
vi.mock("../../../../server/db/client", () => ({
  createDatabase: () => ({
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
    },
    pool: { end: () => Promise.resolve() },
  }),
}));
vi.mock("../../../../server/config", () => ({
  loadConfig: () => ({
    nodeEnv: "test" as const,
    appUrl: new URL("http://localhost:3000"),
    databaseUrl: process.env.DATABASE_URL!,
    settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY!,
  }),
}));
vi.mock("../../../../server/auth/authenticate", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));
vi.mock("../../../../server/incidents/correlator", () => ({
  correlateAlert: (...args: unknown[]) => mockCorrelateAlert(...args),
}));

import { POST as correlateRoute } from "./route";
import { AppError } from "../../../../server/errors";

describe("api/incidents/correlate route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    mockAuthenticateRequest.mockRejectedValue(new AppError("unauthorized", 401));
    const res = await correlateRoute(
      new Request("http://localhost:3000/api/incidents/correlate", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when missing incidents.manage permission", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "user", permissions: ["incidents.read", "incidents.list"] });
    const res = await correlateRoute(
      new Request("http://localhost:3000/api/incidents/correlate", {
        method: "POST",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ alertId: "a-1" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 with stats for single alertId when authorized", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.manage"] });
    mockCorrelateAlert.mockResolvedValue({ incidentId: "inc-1", created: true });
    const res = await correlateRoute(
      new Request("http://localhost:3000/api/incidents/correlate", {
        method: "POST",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ alertId: "a-1" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: { checked: 1, matched: 1, created: 1 } });
    expect(mockCorrelateAlert).toHaveBeenCalledWith(expect.anything(), "a-1");
  });

  it("queries recent high-severity alerts when no alertId passed", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.manage"] });
    const mockLimit = vi.fn().mockResolvedValue([{ id: "a-2" }, { id: "a-3" }]);
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    mockCorrelateAlert
      .mockResolvedValueOnce({ incidentId: "inc-1", created: false })
      .mockResolvedValueOnce({ incidentId: "inc-2", created: true });

    const res = await correlateRoute(
      new Request("http://localhost:3000/api/incidents/correlate", {
        method: "POST",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ limit: 5 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: { checked: 2, matched: 2, created: 1 } });
  });
});
