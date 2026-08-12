import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { listMitreTechniques } from "./service";

const pool = createTestPool();
const db = drizzle(pool, { schema });

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

async function seedAnalysis(verdict: unknown) {
  const [alert] = await db
    .insert(schema.alerts)
    .values({
      fingerprint: `mitre-test-${Math.random()}`,
      wazuhTimestamp: now,
      ingestedAt: minutesAgo(10),
      ruleDescription: "test",
      level: 7,
      rawPayload: { data: {} },
    })
    .returning({ id: schema.alerts.id });
  await db.insert(schema.alertAnalyses).values({
    alertId: alert.id!,
    provider: "test",
    model: "test",
    verdict: verdict as any,
    createdAt: minutesAgo(5),
  });
}

describe("listMitreTechniques", () => {
  beforeEach(async () => {
    await db.delete(schema.alertAnalyses).execute();
    await db.delete(schema.alerts).execute();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns empty when no analyses exist", async () => {
    const result = await listMitreTechniques(db, "30d");
    expect(result).toEqual([]);
  });

  it("returns techniques from a single verdict", async () => {
    await seedAnalysis({
      summary: "Brute force",
      confidence: 0.9,
      mitreAttack: [{ techniqueId: "T1110", techniqueName: "Brute Force", tactic: "Credential Access" }],
    });
    const result = await listMitreTechniques(db, "30d");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ techniqueId: "T1110", tactic: "Credential Access", count: 1 });
  });

  it("deduplicates by techniqueId even when techniqueName or tactic differ", async () => {
    // Same technique, different name casing and tactic — should produce one row.
    await seedAnalysis({
      summary: "s1",
      confidence: 0.8,
      mitreAttack: [{ techniqueId: "T1110", techniqueName: "Brute Force", tactic: "Credential Access" }],
    });
    await seedAnalysis({
      summary: "s2",
      confidence: 0.7,
      mitreAttack: [{ techniqueId: "T1110", techniqueName: "brute force", tactic: "credential-access" }],
    });
    const result = await listMitreTechniques(db, "30d");
    expect(result).toHaveLength(1);
    expect(result[0].techniqueId).toBe("T1110");
    expect(result[0].count).toBe(2);
  });

  it("groups multiple techniques from same alert", async () => {
    await seedAnalysis({
      summary: "Multi-technique",
      confidence: 0.9,
      mitreAttack: [
        { techniqueId: "T1110", techniqueName: "Brute Force", tactic: "Credential Access" },
        { techniqueId: "T1078", techniqueName: "Valid Accounts", tactic: "Initial Access" },
      ],
    });
    const result = await listMitreTechniques(db, "30d");
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.techniqueId);
    expect(ids).toContain("T1110");
    expect(ids).toContain("T1078");
  });

  it("skips entries with missing techniqueId", async () => {
    await seedAnalysis({
      summary: "s",
      confidence: 0.5,
      mitreAttack: [{ techniqueId: "T1110", techniqueName: "Brute Force", tactic: "Credential Access" }],
    });
    // Second analysis has no techniqueId — should be ignored
    await seedAnalysis({
      summary: "s2",
      confidence: 0.5,
      mitreAttack: [{ techniqueId: "", techniqueName: "x", tactic: "x" }],
    });
    const result = await listMitreTechniques(db, "30d");
    expect(result).toHaveLength(1);
    expect(result[0].techniqueId).toBe("T1110");
  });

  it("returns null techniqueName/tactic when absent from verdict", async () => {
    await seedAnalysis({
      summary: "s",
      confidence: 0.5,
      mitreAttack: [{ techniqueId: "T9999" }],
    });
    const result = await listMitreTechniques(db, "30d");
    expect(result).toHaveLength(1);
    expect(result[0].techniqueId).toBe("T9999");
    expect(result[0].techniqueName).toBeNull();
    expect(result[0].tactic).toBeNull();
  });
});
