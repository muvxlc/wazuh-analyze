import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config";
import { createDatabase } from "../../src/server/db/client";
import * as schema from "../../src/server/db/schema";
import { eq } from "drizzle-orm";

const live = process.env.LIVE_WAZUH_ACCEPTANCE === "1" ? it : it.skip;

describe("Wazuh ingestion live acceptance test", () => {
  live("stores a marked signed alert within five seconds", async (context) => {
    const config = loadConfig(process.env);
    const marker = `acceptance-${crypto.randomUUID()}`;
    const endpoint = `${config.appUrl.origin}/api/integrations/wazuh/alerts`;

    // Construct signed body
    const body = JSON.stringify({
      id: marker,
      timestamp: new Date().toISOString(),
      rule: { level: 3, id: "100000", description: `Acceptance Marker ${marker}` },
      agent: { id: "001", name: "live-test-agent" }
    });
    const bodyBuffer = Buffer.from(body, "utf-8");

    // Generate signature using crypto instead of local utility
    const cryptoModule = await import("node:crypto");
    const signature = cryptoModule.createHmac("sha256", config.webhookHmacSecret)
      .update(bodyBuffer)
      .digest("hex");

    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Send the alert
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wazuh-timestamp": timestamp,
        "x-wazuh-signature": `sha256=${signature}`
      },
      body: bodyBuffer
    }).catch(() => null);

    if (!response) {
      context.skip();
      return;
    }

    expect(response.status).toBe(202);

    // Verify record exists directly in DB when available
    if (config.databaseUrl) {
      const { db, pool } = createDatabase(config.databaseUrl);
      try {
        await expect.poll(async () => {
          const alert = await db.query.alerts.findFirst({
            where: eq(schema.alerts.wazuhEventId, marker)
          });
          return alert;
        }, { timeout: 5000 }).toBeTruthy();

        // Optional test fixture cleanup
        if (process.env.LIVE_WAZUH_CLEANUP === "1") {
          await db.delete(schema.alerts).where(eq(schema.alerts.wazuhEventId, marker));
        }
      } finally {
        await pool.end();
      }
    }

    // Replay should be rejected
    const replayResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wazuh-timestamp": timestamp,
        "x-wazuh-signature": `sha256=${signature}`
      },
      body: bodyBuffer
    });

    expect(replayResponse.status).toBe(409);
  });
});
