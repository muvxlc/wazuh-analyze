import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

const mockRunAlertAnalysis = vi.fn();
const mockListAlertAnalyses = vi.fn();
const mockAuthenticateRequest = vi.fn();

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
vi.mock("../../../../../server/ai/analyze-service", () => ({
  runAlertAnalysis: (...args: unknown[]) => mockRunAlertAnalysis(...args),
  listAlertAnalyses: (...args: unknown[]) => mockListAlertAnalyses(...args),
}));

import { GET, POST } from "./route";
import { AppError } from "../../../../../server/errors";

describe("api/alerts/[id]/analysis route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it("returns 200 list on valid GET", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["alerts.details"] });
    mockListAlertAnalyses.mockResolvedValue([{ id: "ans-1", verdict: { summary: "test" } }]);
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", { method: "GET", headers: { cookie: "wazuh_session=valid" } });
    const res = await GET(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: [{ id: "ans-1", verdict: { summary: "test" } }] });
  });

  it("returns 201 created on valid POST", async () => {
    mockAuthenticateRequest.mockResolvedValue({ id: "u-1", role: "admin", permissions: ["alerts.analyze"] });
    mockRunAlertAnalysis.mockResolvedValue({ id: "ans-2", alertId: "a-1", verdict: { summary: "new analysis", confidence: 0.9 } });
    const req = new Request("http://localhost:3000/api/alerts/a-1/analysis", {
      method: "POST",
      headers: { cookie: "wazuh_session=valid", origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ enrich: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "a-1" }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ data: { id: "ans-2", alertId: "a-1", verdict: { summary: "new analysis", confidence: 0.9 } } });
  });
});
