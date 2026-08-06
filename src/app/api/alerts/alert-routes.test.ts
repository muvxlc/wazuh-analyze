import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";

import { GET as getAlerts } from "./route";

describe("Alert routes", () => {
  it("returns 401 when unauthorized", async () => {
    const req = new Request("http://localhost:3000/api/alerts");
    const res = await getAlerts(req);
    expect(res.status).toBe(401);
  });
});
