import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../../server/errors";
import { GET } from "./route";

vi.mock("../../../server/config", () => ({ loadConfig: () => ({ databaseUrl: "postgres://mock", appUrl: new URL("http://localhost:3000"), nodeEnv: "test" }) }));
vi.mock("../../../server/db/client", () => ({ createDatabase: () => ({ db: {}, pool: { end: async () => {} } }) }));
vi.mock("../../../server/auth/authenticate", () => ({ authenticateRequest: async () => { throw new AppError("forbidden", 403); } }));
vi.mock("../../../server/auth/csrf", () => ({ assertCsrfSafe: () => {} }));

describe("user routes authorization", () => {
  it("rejects unauthorized GET /api/users with 403", async () => {
    const res = await GET(new Request("http://localhost:3000/api/users"));
    expect(res.status).toBe(403);
  });
});
