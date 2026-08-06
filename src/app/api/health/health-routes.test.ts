import { describe, expect, it, vi, beforeAll } from "vitest";

// Set required env vars before importing routes (they call loadConfig(process.env) at request time).
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "b".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.test:55000";
process.env.WAZUH_USERNAME = "test-user";
process.env.WAZUH_PASSWORD = "test-pass";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

import { GET as getLive } from "./live/route";

describe("Health routes", () => {
  it("returns liveness process check", async () => {
    const req = new Request("http://localhost:3000/api/health/live");
    const res = await getLive(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  // Ready and Wazuh routes need real DB/Wazuh — skip in unit tests.
  // ponytail: add integration health tests when DB test container available.
});
