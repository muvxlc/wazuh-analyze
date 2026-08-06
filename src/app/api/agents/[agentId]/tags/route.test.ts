import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "a".repeat(32);
process.env.WEBHOOK_HMAC_SECRET = "a".repeat(32);
process.env.WAZUH_API_URL = "https://wazuh.example.com";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

import { GET, POST, DELETE } from "./route";

describe("Agent Tags API route", () => {
  it("returns 401 when unauthorized for GET", async () => {
    const req = new Request("http://localhost:3000/api/agents/001/tags");
    const res = await GET(req, { params: Promise.resolve({ agentId: "001" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 when unauthorized for POST", async () => {
    const req = new Request("http://localhost:3000/api/agents/001/tags", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ tag: "test" }),
    });
    const res = await POST(req, { params: Promise.resolve({ agentId: "001" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 when unauthorized for DELETE", async () => {
    const req = new Request("http://localhost:3000/api/agents/001/tags?tag=test", {
      method: "DELETE",
      headers: { origin: "http://localhost:3000" },
    });
    const res = await DELETE(req, { params: Promise.resolve({ agentId: "001" }) });
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin POST before authentication", async () => {
    const req = new Request("http://localhost:3000/api/agents/001/tags", {
      method: "POST",
      headers: { origin: "https://evil.test" },
      body: JSON.stringify({ tag: "test" }),
    });
    const res = await POST(req, { params: Promise.resolve({ agentId: "001" }) });
    expect(res.status).toBe(403);
  });

  it("rejects cross-origin DELETE before authentication", async () => {
    const req = new Request("http://localhost:3000/api/agents/001/tags?tag=test", {
      method: "DELETE",
      headers: { origin: "https://evil.test" },
    });
    const res = await DELETE(req, { params: Promise.resolve({ agentId: "001" }) });
    expect(res.status).toBe(403);
  });
});
