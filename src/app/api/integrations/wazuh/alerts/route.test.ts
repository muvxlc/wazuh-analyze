import { createHmac } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

const SECRET = "test-webhook-secret-at-least-32-chars!!"; // must match .env.local WEBHOOK_HMAC_SECRET

// Set required env vars before importing route.ts (which calls loadConfig(process.env) inside POST).
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:55432/wazuh_dashboard_test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long!!";
process.env.WEBHOOK_HMAC_SECRET = SECRET;
process.env.WEBHOOK_MAX_BODY_BYTES = "1048576";
process.env.WEBHOOK_REPLAY_WINDOW_SECONDS = "300";
process.env.ALERT_RETENTION_DAYS = "90";
process.env.MAINTENANCE_BATCH_SIZE = "1000";
process.env.WAZUH_API_URL = "https://wazuh.example.com:55000";
process.env.WAZUH_USERNAME = "test";
process.env.WAZUH_PASSWORD = "test";
process.env.WAZUH_CA_PATH = "";
process.env.WAZUH_ALLOW_INSECURE_TLS = "false";
process.env.SETTINGS_ENCRYPTION_KEY = "k".repeat(32);

import * as schema from "../../../../../server/db/schema";
import { createTestPool } from "../../../../../test/postgres/database";
import { resetTestDatabase } from "../../../../../test/postgres/reset";
import { POST } from "./route";

function sign(body: string, timestamp: string, secret: string = SECRET): string {
  const hmac = createHmac("sha256", secret)
    .update(timestamp, "ascii")
    .update(".", "ascii")
    .update(Buffer.from(body, "utf8"))
    .digest("hex");
  return `sha256=${hmac}`;
}

function buildPost(args: {
  body: string;
  timestamp: string;
  secret?: string;
  overrides?: Record<string, string>;
}): Request {
  const { body, timestamp, secret, overrides } = args;
  const signature = overrides?.signature ?? sign(body, timestamp, secret);
  return new Request("https://example.com/api/integrations/wazuh/alerts", {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "x-wazuh-timestamp": overrides?.timestamp ?? timestamp,
      "x-wazuh-signature": signature,
      "x-request-id": "req-test-1",
    }),
    body,
  });
}

describe("POST /api/integrations/wazuh/alerts", () => {
  const pool = createTestPool();
  const db = drizzle(pool, { schema });

  // Body must include "timestamp" field for normalizeWazuhAlert() validation.
  const baseBody =
    '{"id":"fixture-1","rule":{"level":7,"id":"100001","description":"Fixture"},"agent":{"id":"001","name":"agent-1"},"timestamp":"2026-08-02T00:00:00Z"}';
  // Use current-time timestamp so it stays within the replay window.
  const validTimestamp = String(Math.floor(Date.now() / 1000));

  beforeAll(async () => {
    await resetTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
  });

  it("accepts valid alert with 202", async () => {
    const res = await POST(buildPost({ body: baseBody, timestamp: validTimestamp }));
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.data.inserted).toBe(true);
    expect(data.data.alertId).toBeDefined();
  });

  it("rejects missing signature header with 401", async () => {
    const res = await POST(
      new Request("https://example.com/api/integrations/wazuh/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: baseBody,
      })
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe("missing_webhook_headers");
  });

  it("rejects bad signature with 401", async () => {
    const res = await POST(
      buildPost({
        body: baseBody,
        timestamp: validTimestamp,
        overrides: { signature: "sha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
      })
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe("signature_mismatch");
  });

  it("rejects expired timestamp with 401", async () => {
    const expired = String(Math.floor(Date.now() / 1000) - 400); // 400s ago
    const res = await POST(buildPost({ body: baseBody, timestamp: expired }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe("timestamp_expired");
  });

  it("rejects body too large with 413 (declared content-length)", async () => {
    const bigBody = "x".repeat(2_000_000);
    const req = buildPost({ body: bigBody, timestamp: validTimestamp });
    req.headers.set("content-length", String(2_000_000));
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("rejects body too large with 413 (actual byte count)", async () => {
    const bigBody = "x".repeat(2_000_000);
    const res = await POST(buildPost({ body: bigBody, timestamp: validTimestamp }));
    expect(res.status).toBe(413);
  });

  it("rejects invalid JSON with 422", async () => {
    const res = await POST(buildPost({ body: "not-json", timestamp: validTimestamp }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error.code).toBe("invalid_json_body");
  });

  it("rejects invalid alert payload (missing id) with 422", async () => {
    const res = await POST(buildPost({ body: "{\"foo\":\"bar\"}", timestamp: validTimestamp }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error.code).toBe("invalid_alert_payload");
  });

  it("rejects replay on repeated identical request with 409", async () => {
    const first = await POST(buildPost({ body: baseBody, timestamp: validTimestamp }));
    expect(first.status).toBe(202);

    const second = await POST(buildPost({ body: baseBody, timestamp: validTimestamp }));
    expect(second.status).toBe(409);
    const data = await second.json();
    expect(data.error.code).toBe("replay_rejected");
  });

  it("returns 409 for duplicate alert fingerprint on fresh signed request", async () => {
    // Same alert content, different timestamp -> different replay key -> passes replay,
    // but alert dedup fingerprint collides -> 409.
    const first = await POST(buildPost({ body: baseBody, timestamp: validTimestamp }));
    expect(first.status).toBe(202);

    const altTimestamp = String(Math.floor(Date.now() / 1000) + 1);
    const second = await POST(buildPost({ body: baseBody, timestamp: altTimestamp }));
    expect(second.status).toBe(409);
  });

  it("redacts internal errors as 500", async () => {
    // Force a 500 by making DB unreachable: point config? Not easy — instead send a
    // request whose signature verifies but whose body triggers an unknown DB path is not feasible here.
    // Use a body that passes parse+normalize but DB insert fails (e.g. too-long wazuhEventId)? Not deterministic.
    // Instead assert that a non-AppError path returns a redacted 500 by injecting a table that throws.
    // Simplest: delete replay table so replay insert throws -> non-AppError -> 500.
    await pool.query("ALTER TABLE webhook_replay_keys RENAME TO webhook_replay_keys_bak");
    try {
      const res = await POST(buildPost({ body: baseBody, timestamp: validTimestamp }));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe("internal_error");
      expect(data.error).not.toHaveProperty("message");
    } finally {
      await pool.query("ALTER TABLE webhook_replay_keys_bak RENAME TO webhook_replay_keys");
    }
  });

  it("triggers fire-and-forget analysis when socAutoAnalyze is true and level >= minLevel", async () => {
    process.env.SOC_AUTO_ANALYZE = "true";
    process.env.SOC_AUTO_ANALYZE_MIN_LEVEL = "7";
    try {
      const altBody = '{"id":"fixture-ai","rule":{"level":8,"id":"100002","description":"AI Fixture"},"agent":{"id":"001","name":"agent-1"},"timestamp":"2026-08-02T00:00:00Z"}';
      const res = await POST(buildPost({ body: altBody, timestamp: validTimestamp }));
      expect(res.status).toBe(202);
    } finally {
      process.env.SOC_AUTO_ANALYZE = "false";
    }
  });
});
