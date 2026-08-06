import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { getSocMetrics, parseSocRange } from "./soc-metrics";

const pool = createTestPool();
const db = drizzle(pool, { schema });

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const adminActor = {
  userId: "u-admin",
  role: "admin" as const,
  permissions: new Set(["dashboard.read" as const]),
};
const guestActor = {
  userId: "u-guest",
  role: "user" as const,
  permissions: new Set<string>(),
};

async function seedAlert(partial: Partial<typeof schema.alerts.$inferInsert>) {
  const [row] = await db
    .insert(schema.alerts)
    .values({
      fingerprint: `fp-${Math.random()}`,
      wazuhTimestamp: now,
      ingestedAt: minutesAgo(10),
      ruleDescription: "test rule",
      level: 7,
      rawPayload: { data: { srcip: "10.0.0.5" } },
      ...partial,
    })
    .returning({ id: schema.alerts.id });
  return row!.id;
}

beforeAll(async () => {
  await resetTestDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe("getSocMetrics", () => {
  beforeEach(async () => {
    await db.delete(schema.alertAnalyses).execute();
    await db.delete(schema.alerts).execute();
    await db.delete(schema.incidents).execute();
  });

  it("denies without dashboard.read", async () => {
    await expect(getSocMetrics(db as any, guestActor, "24h")).rejects.toThrow();
  });

  it("computes MTTD, MTTR, false-positive rate, MITRE, TI and backlog", async () => {
    const alertA = await seedAlert({
      ingestedAt: minutesAgo(10),
      acknowledgedAt: minutesAgo(5),
      resolvedAt: minutesAgo(1),
      level: 3,
      ruleId: "5501",
      ruleDescription: "FP-ish",
      agentId: "001",
      agentName: "agent-a",
    });
    const alertB = await seedAlert({
      ingestedAt: minutesAgo(8),
      acknowledgedAt: minutesAgo(2),
      level: 12,
      ruleId: "5502",
      ruleDescription: "RDP brute",
      agentId: "002",
      agentName: "agent-b",
      rawPayload: { data: { srcip: "203.0.113.9" } },
    });

    // A = false positive, B = real (latest verdict wins per alert).
    await db.insert(schema.alertAnalyses).values({
      alertId: alertA,
      provider: "test",
      model: "test",
      verdict: { summary: "noise", confidence: 0.9, likelyFalsePositive: false },
      createdAt: minutesAgo(8),
    });
    await db.insert(schema.alertAnalyses).values({
      alertId: alertA,
      provider: "test",
      model: "test",
      verdict: {
        summary: "confirmed noise",
        confidence: 0.95,
        likelyFalsePositive: true,
        mitreAttack: [{ techniqueId: "T1190", techniqueName: "Exploit Pub-Facing", tactic: "Initial Access" }],
      },
      iocLookups: [{ abuseCategory: "malware", abuseScore: 90 }],
      createdAt: minutesAgo(3),
    });
    await db.insert(schema.alertAnalyses).values({
      alertId: alertB,
      provider: "test",
      model: "test",
      verdict: {
        summary: "real brute",
        confidence: 0.8,
        mitreAttack: [{ techniqueId: "T1110", techniqueName: "Brute Force", tactic: "Credential Access" }],
      },
      iocLookups: [{ abuseCategory: "spam", abuseScore: 20 }],
      createdAt: minutesAgo(2),
    });

    await db.insert(schema.incidents).values({
      title: "open incident",
      status: "open",
      severity: "high",
    });

    const metrics = await getSocMetrics(db as any, adminActor, "24h");

    expect(metrics.range).toBe("24h");
    // MTTD = avg(5min, 6min) ~ 330s, MTTR over alertA only (1 alert resolved).
    expect(metrics.mttdSeconds).toBeGreaterThan(0);
    expect(metrics.mttrSeconds).toBeGreaterThan(0);
    expect(metrics.falsePositiveRate).toBeCloseTo(0.5, 1); // 1 FP of 2 analyzed
    expect(metrics.topRules.map((r) => r.ruleId)).toContain("5502");
    expect(metrics.topAgents.map((a) => a.agentId)).toEqual(expect.arrayContaining(["001", "002"]));
    expect(metrics.topSourceIps.find((s) => s.sourceIp === "203.0.113.9")?.count).toBe(1);
    const tactics = metrics.mitreHeatmap.map((m) => m.tactic);
    expect(tactics).toEqual(expect.arrayContaining(["Initial Access", "Credential Access"]));
    expect(metrics.threatIntelDistribution.map((t) => t.category)).toEqual(
      expect.arrayContaining(["malware", "spam"]),
    );
    expect(metrics.incidentBacklog).toBe(1);
    expect(metrics.alertsOverTime.length).toBeGreaterThan(0);
  });

  it("returns null rates when nothing analyzed/acknowledged", async () => {
    const metrics = await getSocMetrics(db as any, adminActor, "24h");
    expect(metrics.mttdSeconds).toBeNull();
    expect(metrics.mttrSeconds).toBeNull();
    expect(metrics.falsePositiveRate).toBeNull();
    expect(metrics.mitreHeatmap).toEqual([]);
    expect(metrics.incidentBacklog).toBe(0);
  });
});

describe("parseSocRange", () => {
  it.each([
    [undefined, "24h"],
    ["7d", "7d"],
    ["30d", "30d"],
    ["garbage", "24h"],
  ])("maps %s to %s", (input, expected) => {
    expect(parseSocRange(input)).toBe(expected);
  });
});
