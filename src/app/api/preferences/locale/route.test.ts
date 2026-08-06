import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const mockCookies = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookies)),
}));

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

const mockPool = {
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../../server/db/client", () => ({
  createDatabase: vi.fn(() => ({ db: mockDb, pool: mockPool })),
}));

vi.mock("../../../../server/config", () => ({
  loadConfig: vi.fn(() => ({
    databaseUrl: "postgres://test:test@localhost:5432/test",
    appUrl: new URL("http://localhost:3000"),
    nodeEnv: "test",
  })),
}));

vi.mock("../../../../server/auth/csrf", () => ({
  assertCsrfSafe: vi.fn(),
}));

describe("POST /api/preferences/locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates locale in cookie when unauthenticated", async () => {
    const request = new Request("http://localhost:3000/api/preferences/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "th" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockCookies.set).toHaveBeenCalledWith("NEXT_LOCALE", "th", expect.any(Object));
  });

  it("rejects invalid locale value", async () => {
    const request = new Request("http://localhost:3000/api/preferences/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "fr" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(422);
  });
});
