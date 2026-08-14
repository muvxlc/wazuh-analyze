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
const mockSetIncidentAssignee = vi.fn();
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
vi.mock("server-only", () => ({}));
vi.mock("../../../server/incidents/query", () => ({
  listIncidents: (...args: unknown[]) => mockListIncidents(...args),
  getIncidentDetail: (...args: unknown[]) => mockGetIncidentDetail(...args),
}));
vi.mock("../../../server/incidents/workflow", () => ({
  transitionIncident: (...args: unknown[]) => mockTransitionIncident(...args),
  setIncidentAssignee: (...args: unknown[]) => mockSetIncidentAssignee(...args),
}));

import { GET as listIncidentsRoute } from "./route";
import { GET as incidentDetailRoute, PATCH as incidentPatchRoute } from "./[id]/route";
import { POST as incidentStatusRoute } from "./[id]/status/route";
import { POST as incidentBulkRoute } from "./bulk/route";
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

  it("passes search and assignee filters to listIncidents", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.list"] });
    mockListIncidents.mockResolvedValue({ items: [], total: 0 });
    const res = await listIncidentsRoute(
      new Request("http://localhost:3000/api/incidents?q=ssh&limit=10&offset=20", {
        headers: { cookie: "wazuh_session=valid" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockListIncidents).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ q: "ssh", limit: 10, offset: 20 }),
    );
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

  it("PATCH assign calls setIncidentAssignee and returns detail", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.manage"] });
    mockSetIncidentAssignee.mockResolvedValue({ id: "inc-1", assigneeUserId: "u-2", status: "open" });
    const res = await incidentPatchRoute(
      new Request("http://localhost:3000/api/incidents/inc-1", {
        method: "PATCH",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ assigneeUserId: "11111111-1111-4111-8111-111111111111" }),
      }),
      { params: Promise.resolve({ id: "inc-1" }) },
    );
    expect(res.status).toBe(200);
    expect(mockSetIncidentAssignee).toHaveBeenCalled();
    const body = await res.json();
    expect(body.data.assigneeUserId).toBe("u-2");
  });

  it("bulk applies status + records per-id results", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["incidents.manage"] });
    mockTransitionIncident
      .mockResolvedValueOnce({ id: "inc-a", status: "resolved" })
      .mockRejectedValueOnce(new Error("cannot transition"));
    const res = await incidentBulkRoute(
      new Request("http://localhost:3000/api/incidents/bulk", {
        method: "POST",
        headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ ids: ["11111111-1111-4111-8111-11111111111a", "11111111-1111-4111-8111-11111111111b"], to: "resolved" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.succeeded).toBe(1);
    expect(body.data.failed).toBe(1);
    expect(body.data.results).toHaveLength(2);
  });
});
