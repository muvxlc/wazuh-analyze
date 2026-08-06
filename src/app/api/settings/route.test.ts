import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

const mockGetDisplayConfig = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock("../../../server/db/client", () => ({
  createDatabase: () => ({ db: {}, pool: { end: () => Promise.resolve() } }),
}));
vi.mock("../../../server/config", () => ({
  loadConfig: () => ({
    nodeEnv: "test" as const,
    appUrl: new URL("http://localhost:3000"),
    alertRetentionDays: 90,
    maintenanceBatchSize: 1000,
    wazuh: {
      apiUrl: new URL("https://wazuh.example.com"),
      username: "test",
      password: "secret",
      caPath: null,
      allowInsecureTls: false,
    },
    databaseUrl: process.env.DATABASE_URL!,
    settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY!,
  }),
}));
vi.mock("../../../server/auth/authenticate", () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    id: "user-1",
    email: "test@example.com",
    displayName: "Tester",
    role: "admin",
    locale: "en",
    permissions: new Set(["settings.manage"]),
    sessionId: "sid-1",
  }),
}));
vi.mock("../../../server/auth/cookies", () => ({
  SESSION_COOKIE: "wazuh_session",
}));
vi.mock("../../../server/http/request-metadata", () => ({
  getRequestMetadata: () => ({ requestId: "req-1", ip: "127.0.0.1", userAgent: "test/1" }),
}));
vi.mock("../../../server/settings/service", () => ({
  getDisplayConfig: (...args: unknown[]) => mockGetDisplayConfig(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));
vi.mock("server-only", () => ({}));

import { GET, PATCH } from "./route";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { AppError } from "../../../server/errors";

function sessionCookie(value: string) {
  return new Request("http://localhost:3000/api/settings", {
    headers: { cookie: `wazuh_session=${value}`, origin: "http://localhost:3000" },
  });
}

describe("Settings route", () => {
  const mockAuth = vi.mocked(authenticateRequest);

  beforeEach(() => {
    mockGetDisplayConfig.mockReset();
    mockUpdateSettings.mockReset();
    mockAuth.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      displayName: "Tester",
      role: "admin",
      locale: "en",
      permissions: new Set(["settings.manage"]),
      sessionId: "sid-1",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockRejectedValueOnce(new AppError("unauthenticated", 401));
    const res = await GET(sessionCookie("token"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks settings.manage", async () => {
    mockAuth.mockResolvedValueOnce({
      id: "user-1",
      email: "test@example.com",
      displayName: "Tester",
      role: "user",
      locale: "en",
      permissions: new Set(["dashboard.read"]),
      sessionId: "sid-1",
    });
    const res = await GET(sessionCookie("token"));
    expect(res.status).toBe(403);
  });

  it("returns safe nonsecret values on GET with settings.manage", async () => {
    mockGetDisplayConfig.mockResolvedValue({
      retentionDays: 90,
      maintenanceBatchSize: 1000,
      nodeEnv: "test",
      appUrl: "http://localhost:3000",
      wazuhApiUrl: "https://wazuh.example.com",
      wazuhUsernameSet: true,
      wazuhAllowInsecureTls: false,
      wazuhPasswordSet: true,
      wazuhCaPath: null,
      sources: {},
    });
    const res = await GET(sessionCookie("token"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.retentionDays).toBe(90);
    expect(json.data.wazuhPasswordSet).toBe(true);
    // Secrets never appear in response.
    const body = JSON.stringify(json);
    expect(body).not.toContain("secret");
    expect(body).not.toContain("password");
  });

  it("returns 422 on PATCH with empty body", async () => {
    const res = await PATCH(
      new Request("http://localhost:3000/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("returns 422 on PATCH with invalid retentionDays", async () => {
    const res = await PATCH(
      new Request("http://localhost:3000/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ retentionDays: -1 }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects removed legacy LM Studio settings", async () => {
    const res = await PATCH(
      new Request("http://localhost:3000/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ lmStudioModel: "deepseek" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("patches settings and returns updated nonsecret summary", async () => {
    mockGetDisplayConfig.mockResolvedValue({
      retentionDays: 30,
      maintenanceBatchSize: 1000,
      nodeEnv: "test",
      appUrl: "http://localhost:3000",
      wazuhApiUrl: "https://updated.example.com:55000",
      wazuhUsernameSet: true,
      wazuhAllowInsecureTls: false,
      wazuhPasswordSet: true,
      wazuhCaPath: null,
      sources: { alertRetentionDays: true, wazuhApiUrl: true },
    });
    const res = await PATCH(
      new Request("http://localhost:3000/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          alertRetentionDays: 30,
          wazuhApiUrl: "https://updated.example.com:55000",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.retentionDays).toBe(30);
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        settings: expect.arrayContaining([
          expect.objectContaining({ key: "alertRetentionDays" }),
          expect.objectContaining({ key: "wazuhApiUrl" }),
        ]),
      }),
    );
  });
});
