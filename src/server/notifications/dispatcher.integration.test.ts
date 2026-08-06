import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";

import * as schema from "../db/schema";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { encryptSecret } from "../settings/encryption";
import { dispatchNotification } from "./dispatcher";
import type { Database } from "../db/types";

const TEST_KEY = "test-encryption-key-at-least-32-bytes-long!";

describe("notification dispatcher (integration)", () => {
  const pool = createTestPool();
  const db = drizzle(pool, { schema }) as unknown as Database;

  beforeAll(async () => {
    await resetTestDatabase(pool);
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createChannelAndRule(opts: {
    eventType: "alert.high_severity" | "incident.created" | "incident.escalated" | "verdict.confident_real";
    threshold?: number;
    channelType?: "discord" | "telegram";
    channelEnabled?: boolean;
    ruleEnabled?: boolean;
    config?: Record<string, string>;
  }) {
    const encConfig = encryptSecret(
      JSON.stringify(opts.config ?? { webhookUrl: "https://discord.local/webhook" }),
      TEST_KEY,
    );
    const [chan] = await db
      .insert(schema.notificationChannels)
      .values({
        name: "Test Chan",
        type: opts.channelType ?? "discord",
        config: encConfig,
        enabled: opts.channelEnabled ?? true,
      })
      .returning({ id: schema.notificationChannels.id });

    const [rule] = await db
      .insert(schema.notificationRules)
      .values({
        eventType: opts.eventType,
        severityThreshold: opts.threshold ?? null,
        channelId: chan!.id,
        enabled: opts.ruleEnabled ?? true,
      })
      .returning({ id: schema.notificationRules.id });

    return { channelId: chan!.id, ruleId: rule!.id };
  }

  it("does nothing when no active rules exist for event type", async () => {
    const fetchMock = vi.fn();
    await dispatchNotification(
      db,
      { type: "alert.high_severity", targetId: "test-1", title: "Test Alert" },
      TEST_KEY,
      { fetchFn: fetchMock as unknown as typeof fetch },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const deliveries = await db.select().from(schema.notificationDeliveries);
    expect(deliveries).toHaveLength(0);
  });

  it("respects severity threshold filtering", async () => {
    await createChannelAndRule({ eventType: "alert.high_severity", threshold: 12 });
    const fetchMock = vi.fn();

    // Severity 11 is below threshold of 12 -> should be ignored
    await dispatchNotification(
      db,
      { type: "alert.high_severity", targetId: "test-2", severity: 11, title: "Modest Alert" },
      TEST_KEY,
      { fetchFn: fetchMock as unknown as typeof fetch },
    );
    expect(fetchMock).not.toHaveBeenCalled();

    // Severity 12 triggers rule
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await dispatchNotification(
      db,
      { type: "alert.high_severity", targetId: "test-3", severity: 12, title: "High Alert" },
      TEST_KEY,
      { fetchFn: fetchMock as unknown as typeof fetch },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const deliveries = await db.select().from(schema.notificationDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("sent");
  });

  it("isolates channel transmission failure and records failed delivery and error", async () => {
    await createChannelAndRule({ eventType: "incident.created" });
    const failingFetch = vi.fn().mockRejectedValueOnce(new Error("DNS unreachable"));

    // Should not throw to caller!
    await expect(
      dispatchNotification(
        db,
        { type: "incident.created", targetId: "inc-1", title: "Incident 1" },
        TEST_KEY,
        { fetchFn: failingFetch as unknown as typeof fetch },
      ),
    ).resolves.not.toThrow();

    const deliveries = await db.select().from(schema.notificationDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("failed");
    expect(deliveries[0]!.error).toContain("DNS unreachable");
  });

  it("logs delivery and audit event on successful transmission", async () => {
    const { channelId } = await createChannelAndRule({
      eventType: "verdict.confident_real",
      channelType: "telegram",
      config: { botToken: "bot123", chatId: "chat99" },
    });
    const successFetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));

    await dispatchNotification(
      db,
      { type: "verdict.confident_real", targetId: "alert-99", title: "AI Confirmed Threat", summary: "Malicious IP" },
      TEST_KEY,
      { fetchFn: successFetch as unknown as typeof fetch, actorUserId: null },
    );

    const deliveries = await db.select().from(schema.notificationDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("sent");
    expect(deliveries[0]!.channelId).toBe(channelId);

    const audits = await db.select().from(schema.auditEvents);
    const notifAudit = audits.find((a) => a.action === "notification.send");
    expect(notifAudit).toBeDefined();
    expect(notifAudit!.targetId).toBe(channelId);
  });
});
