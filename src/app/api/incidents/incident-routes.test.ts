import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

const mockListIncidents = vi.fn();
const mockGetIncidentDetail = vi.fn();
const mockTransitionIncident = vi.fn();
const mockAuthenticateRequest = vi.fn();

vi.mock("../../../server/db/client", () => ({
  createDatabase: () => ({ db: {}, pool: { end: () => Promise.resolve() } }),
}));
vi.mock("../../../server/config", () => ({
  loadConfig: () => ({
    nodeEnv: "test" as const,
    appUrl: new URL("http://localhost:3000"),
    databaseUrl: process.env.DATABASE_URL!,
    settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY!,
  }),
}));
vi.mock("../../../server/auth/authenticate", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));
vi.mock("../../../server/incidents/query", () => ({
  listIncidents: (...args: unknown[]) => mockListIncidents(...args),
  getIncidentDetail: (...args: unknown[]) => mockGetIncidentDetail(...args),
}));
vi.mock("../../../server/incidents/workflow", () => ({
  transitionIncident: (...args: unknown[]) => mockTransitionIncident(...args),
}));

import { GET as listIncidentsRoute } from "./route";
import { GET as incidentDetailRoute } from "./[id]/route";
import { POST as incidentStatusRoute } from "./[id]/status/route";
import { AppError } from "../../../server/errors";

describe("api/incidents routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 on list when unauthorized", async () => {
    mockAuthenticateRequest.mockRejectedValue(new AppError("unauthorized", 401));
    const res = await listIncidentsRoute(new Request("http://localhost:3000/api/incidents"));
    expect(res.status).toBe(401);
  });

  it("returns 200 list with data when authorized", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.list"] });
    mockListIncidents.mockResolvedValue({ items: [{ id: "inc-1" }], total: 1 });
    const res = await listIncidentsRoute(
      new Request("http://localhost:3000/api/incidents?status=open", {
        headers: { cookie: "wazuh_session=valid" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: { items: [{ id: "inc-1" }], total: 1 } });
  });

  it("returns 404 when incident not found", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.read"] });
    mockGetIncidentDetail.mockRejectedValue(new AppError("incident_not_found", 404));
    const res = await incidentDetailRoute(
      new Request("http://localhost:3000/api/incidents/missing", {
        headers: { cookie: "wazuh_session=valid" },
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 detail when authorized", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.read"] });
    mockGetIncidentDetail.mockResolvedValue({ id: "inc-1", status: "open", timeline: [] });
    const res = await incidentDetailRoute(
      new Request("http://localhost:3000/api/incidents/inc-1", {
        headers: { cookie: "wazuh_session=valid" },
      }),
      { params: Promise.resolve({ id: "inc-1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("inc-1");
  });

  it("returns 200 on valid status transition", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.manage"] });
    mockTransitionIncident.mockResolvedValue({ id: "inc-1", status: "resolved" });
    const res = await incidentStatusRoute(
      new Request("http://localhost:3000/api/incidents/inc-1/status", {
        method: "POST",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ to: "resolved" }),
      }),
      { params: Promise.resolve({ id: "inc-1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("resolved");
  });

  it("returns 403 on transition without incidents.manage", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "user", permissions: ["incidents.read"] });
    mockTransitionIncident.mockRejectedValue(new AppError("forbidden", 403, { permission: "incidents.manage" }));
    const res = await incidentStatusRoute(
      new Request("http://localhost:3000/api/incidents/inc-1/status", {
        method: "POST",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ to: "investigating" }),
      }),
      { params: Promise.resolve({ id: "inc-1" }) },
    );
    expect(res.status).toBe(403);
  });
});
