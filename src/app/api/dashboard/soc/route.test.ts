import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppError } from "../../../../server/errors";

const mockGetSocMetrics = vi.fn();
const mockAuth = vi.fn();

vi.mock("../../../../server/db/client", () => ({
  createDatabase: () => ({ db: {}, pool: { end: () => Promise.resolve() } }),
}));
vi.mock("../../../../server/config", () => ({
  loadConfig: () => ({ databaseUrl: "postgresql://test:test@localhost:5432/test" }),
}));
vi.mock("../../../../server/auth/authenticate", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuth(...args),
}));
vi.mock("../../../../server/auth/cookies", () => ({
  SESSION_COOKIE: "wazuh_session",
}));
vi.mock("../../../../server/dashboard/soc-metrics", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getSocMetrics: (...args: unknown[]) => mockGetSocMetrics(...args),
}));
vi.mock("server-only", () => ({}));

import { GET } from "./route";

function makeReq(range = "24h") {
  return new Request(`http://localhost:3000/api/dashboard/soc?range=${range}`, {
    headers: { cookie: "wazuh_session=test" },
  });
}

describe("GET /api/dashboard/soc", () => {
  beforeEach(() => {
    mockGetSocMetrics.mockReset();
    mockAuth.mockReset().mockResolvedValue({
      id: "u1",
      role: "admin",
      permissions: ["dashboard.read"],
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockRejectedValueOnce(new AppError("unauthenticated", 401));
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 when lacking permission", async () => {
    mockGetSocMetrics.mockRejectedValueOnce(new AppError("forbidden", 403));
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it("returns 200 with metrics payload", async () => {
    mockGetSocMetrics.mockResolvedValueOnce({ range: "7d", incidentBacklog: 5 });
    const res = await GET(makeReq("7d"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ range: "7d", incidentBacklog: 5 });
    expect(mockGetSocMetrics).toHaveBeenCalledWith(expect.anything(), expect.anything(), "7d");
  });
});
