import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

const mockListAlertAnalyses = vi.fn();
const mockGetQueuePhase = vi.fn();
const mockSetQueuePhase = vi.fn();
const mockEnqueueAlertAnalysis = vi.fn();
const mockAuthenticateRequest = vi.fn();
const mockRequirePermission = vi.fn();

vi.mock("../../../../../server/db/client", () => ({
  createDatabase: () => ({ db: {}, pool: { end: () => Promise.resolve() } }),
}));
vi.mock("../../../../../server/config", () => ({
  loadConfig: () => ({
    nodeEnv: "test" as const,
    appUrl: new URL("http://localhost:3000"),
    databaseUrl: process.env.DATABASE_URL!,
    settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY!,
  }),
}));
vi.mock("../../../../../server/auth/authenticate", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));
vi.mock("../../../../../server/authorization/require", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));
vi.mock("../../../../../server/ai/analyze-service", () => ({
  listAlertAnalyses: (...args: unknown[]) => mockListAlertAnalyses(...args),
}));
vi.mock("../../../../../server/daemon/progress", () => ({
  setQueuePhase: (...args: unknown[]) => mockSetQueuePhase(...args),
  getQueuePhase: (...args: unknown[]) => mockGetQueuePhase(...args),
}));
vi.mock("../../../../../server/daemon/queue", () => ({
  enqueueAlertAnalysis: (...args: unknown[]) => mockEnqueueAlertAnalysis(...args),
  QUEUE_ANALYZE_ALERT: "analyze-alert",
}));

import { GET, POST } from "./route";
import { AppError } from "../../../../../server/errors";

describe("api/alerts/[id]/analysis route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSetQueuePhase.mockResolvedValue(undefined);
    mockEnqueueAlertAnalysis.mockResolvedValue(undefined);
    mockRequirePermission.mockImplementation(() => {});
  });

  it("returns 401 when unauthorized on GET", async () => {
    mockAuthenticateRequest.mockRejectedValue(new AppError("unauthorized", 401, { message: "Unauthorized" }));
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when forbidden on GET", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "user", permissions: [] });
    mockListAlertAnalyses.mockRejectedValue(new AppError("forbidden", 403, { message: "Missing required permission" }));
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", { method: "GET", headers: { cookie: "wazuh_session=valid" } });
    const res = await GET(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 200 list with progress including detail on valid GET", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["alerts.details"] });
    mockListAlertAnalyses.mockResolvedValue([{ id: "ans-1", verdict: { summary: "test" } }]);
    mockGetQueuePhase.mockResolvedValue({ phase: "failed", status: "error", detail: "AI timeout", updatedAt: new Date() });
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", { method: "GET", headers: { cookie: "wazuh_session=valid" } });
    const res = await GET(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      data: [{ id: "ans-1", verdict: { summary: "test" } }],
      progress: { phase: "failed", status: "error", detail: "AI timeout" },
    });
  });

  it("returns 200 with null progress when no queued job", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["alerts.details"] });
    mockListAlertAnalyses.mockResolvedValue([]);
    mockGetQueuePhase.mockResolvedValue(null);
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", { method: "GET", headers: { cookie: "wazuh_session=valid" } });
    const res = await GET(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: [], progress: null });
  });

  it("returns 202 queued on valid POST", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["alerts.analyze"] });
    mockSetQueuePhase.mockResolvedValue(undefined);
    mockEnqueueAlertAnalysis.mockResolvedValue(undefined);
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", {
      method: "POST",
      headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ enrich: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ data: { queued: true, alertId: "a-1" } });
    expect(mockSetQueuePhase).toHaveBeenCalledWith(expect.anything(), "analyze-alert", "a-1", "queued");
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.arrayContaining(["alerts.analyze"]), "alerts.analyze");
    expect(mockEnqueueAlertAnalysis).toHaveBeenCalledWith("a-1", { force: true, enrich: true });
  });

  it("POST returns 403 when user lacks alerts.analyze permission", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "user", permissions: new Set() });
    mockRequirePermission.mockImplementation(() => { throw new AppError("forbidden", 403, { permission: "alerts.analyze" }); });
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", {
      method: "POST",
      headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ enrich: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(403);
    expect(mockSetQueuePhase).not.toHaveBeenCalled();
    expect(mockEnqueueAlertAnalysis).not.toHaveBeenCalled();
  });

  it("POST rejects missing CSRF origin", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["alerts.analyze"] });
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", {
      method: "POST",
      headers: { cookie: "wazuh_session=valid", "content-type": "application/json" },
      body: JSON.stringify({ enrich: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(403);
  });

  it("POST returns 500 and cleans up progress when enqueueAlertAnalysis fails after setQueuePhase", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["alerts.analyze"] });
    mockSetQueuePhase.mockResolvedValue(undefined);
    mockEnqueueAlertAnalysis.mockRejectedValueOnce(new Error("pg-boss unavailable"));
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", {
      method: "POST",
      headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ enrich: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(500);
    expect(mockSetQueuePhase).toHaveBeenNthCalledWith(1, expect.anything(), "analyze-alert", "a-1", "queued");
    expect(mockSetQueuePhase).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "analyze-alert",
      "a-1",
      "failed",
      { detail: "pg-boss unavailable" },
    );
    expect(mockEnqueueAlertAnalysis).toHaveBeenCalledWith("a-1", { force: true, enrich: true });
  });

  it("POST returns 500 and cleans up progress when setQueuePhase fails before enqueue", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["alerts.analyze"] });
    mockSetQueuePhase.mockRejectedValueOnce(new Error("db connection lost"));
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", {
      method: "POST",
      headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ enrich: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(500);
    expect(mockEnqueueAlertAnalysis).not.toHaveBeenCalled();
  });


  it("POST returns 401 when authenticateRequest fails after CSRF check", async () => {
    mockAuthenticateRequest.mockRejectedValueOnce(new AppError("unauthorized", 401, { message: "Unauthorized" }));
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", {
      method: "POST",
      headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ enrich: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(401);
    expect(mockSetQueuePhase).not.toHaveBeenCalled();
    expect(mockEnqueueAlertAnalysis).not.toHaveBeenCalled();
  });
});
