import { AppError } from "../../../server/errors";
import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { POST as revokePOST } from "./[token]/revoke/route";

vi.mock("../../../server/config", () => ({ loadConfig: () => ({ databaseUrl: "postgres://mock", appUrl: new URL("http://localhost:3000"), nodeEnv: "test" }) }));
vi.mock("../../../server/db/client", () => ({ createDatabase: () => ({ db: {}, pool: { end: async () => {} } }) }));
vi.mock("../../../server/auth/authenticate", () => ({ authenticateRequest: async () => { throw new AppError("forbidden", 403); } }));
vi.mock("../../../server/auth/csrf", () => ({ assertCsrfSafe: () => {} }));

describe("invite routes authorization", () => {
  it("rejects unauthorized GET /api/invites with 403", async () => {
    const res = await GET(new Request("http://localhost:3000/api/invites"));
    expect(res.status).toBe(403);
  });

  it("rejects unauthorized POST /api/invites with 403", async () => {
    const res = await POST(new Request("http://localhost:3000/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "new@example.com", role: "user" }) }));
    expect(res.status).toBe(403);
  });

  it("rejects unauthorized POST /api/invites/[id]/revoke with 403", async () => {
    const res = await revokePOST(new Request("http://localhost:3000/api/invites/123/revoke", { method: "POST" }), { params: Promise.resolve({ token: "123" }) });
    expect(res.status).toBe(403);
  });
});
