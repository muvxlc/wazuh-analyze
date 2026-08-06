import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { normalizeWazuhAlert } from "./normalize";
import { persistAlert } from "./alert-repository";
import { listAlerts, makeActor } from "./query";
import type { AlertListQuery } from "./query";

const pool = createTestPool();
const db = drizzle(pool, { schema });

async function insertActor(role: "admin" | "user" = "admin"): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `query-test-${role}-${Date.now()}@example.com`,
      normalizedEmail: `query-test-${role}-${Date.now()}@example.com`,
      displayName: `Query ${role}`,
      passwordHash: "hash-test",
      role,
      locale: "en",
      isActive: true,
    })
    .returning({ id: schema.users.id });
  return user.id!;
}

async function seedAlerts(count: number, baseLevel: number = 5) {
  for (let i = 0; i < count; i++) {
    const raw = {
      id: `evt-query-${i}`,
      timestamp: `2026-08-0${Math.min(i + 1, 9)}T10:00:00Z`,
      rule: {
        level: baseLevel + (i % 3),
        id: `${500000 + i}`,
        description: `Rule ${i} description text`,
        groups: ["group-a"],
      },
      agent: { id: `agent-${i % 3}`, name: `host-${i % 3}` },
    };
    const normalized = normalizeWazuhAlert(raw);
    await persistAlert(db, normalized);
  }
}

describe("listAlerts integration", () => {
  let adminId: string;
  let userId: string;
  let adminActor: ReturnType<typeof makeActor>;
  let userActor: ReturnType<typeof makeActor>;

  beforeAll(async () => {
    adminId = await insertActor("admin");
    userId = await insertActor("user");
    adminActor = makeActor(adminId, "admin");
    userActor = makeActor(userId, "user");
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
    adminId = await insertActor("admin");
    userId = await insertActor("user");
    adminActor = makeActor(adminId, "admin");
    userActor = makeActor(userId, "user");
  });

  it("returns alerts ordered by ingested_at DESC, id DESC", async () => {
    await seedAlerts(5, 5);
    const page = await listAlerts(db, adminActor, {});
    expect(page.items).toHaveLength(5);
    for (let i = 1; i < page.items.length; i++) {
      const prev = page.items[i - 1];
      const curr = page.items[i];
      expect(curr.ingestedAt.getTime()).toBeLessThanOrEqual(prev.ingestedAt.getTime());
    }
  });

  it("validates limit between 1 and 100", async () => {
    await seedAlerts(3, 5);
    await expect(listAlerts(db, adminActor, { limit: 0 })).rejects.toThrow();
    await expect(listAlerts(db, adminActor, { limit: 101 })).rejects.toThrow();
    const page1 = await listAlerts(db, adminActor, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    const page100 = await listAlerts(db, adminActor, { limit: 100 });
    expect(page100.items).toHaveLength(3);
  });

  it("searches normalized description field", async () => {
    await seedAlerts(3, 5);
    const page = await listAlerts(db, adminActor, { search: "Rule 1 description" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some((a) => a.ruleDescription.includes("Rule 1"))).toBe(true);
  });

  it("searches normalized agent fields", async () => {
    await seedAlerts(3, 5);
    const page = await listAlerts(db, adminActor, { agentId: "agent-0" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((a) => a.agentId === "agent-0")).toBe(true);
  });

  it("filters by status", async () => {
    await seedAlerts(3, 5);
    const page = await listAlerts(db, adminActor, { status: "open" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((a) => a.status === "open")).toBe(true);
  });

  it("paginates correctly with cursor", async () => {
    await seedAlerts(5, 5);
    const first = await listAlerts(db, adminActor, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.cursor).toBeDefined();

    const second = await listAlerts(db, adminActor, { limit: 2, cursor: first.cursor! });
    expect(second.items).toHaveLength(2);
    const firstIds = new Set(first.items.map((a) => a.id));
    const secondIds = new Set(second.items.map((a) => a.id));
    let overlap = 0;
    for (const id of secondIds) {
      if (firstIds.has(id)) overlap++;
    }
    expect(overlap).toBe(0);
  });

  it("respects cursor ordering", async () => {
    await seedAlerts(5, 5);
    const first = await listAlerts(db, adminActor, { limit: 2 });
    const second = await listAlerts(db, adminActor, { limit: 2, cursor: first.cursor! });
    const lastFirst = first.items[first.items.length - 1];
    for (const item of second.items) {
      expect(
        item.ingestedAt.getTime() < lastFirst.ingestedAt.getTime() ||
        (item.ingestedAt.getTime() === lastFirst.ingestedAt.getTime() && item.id < lastFirst.id),
      ).toBe(true);
    }
  });

  it("allows user role with alerts.list permission", async () => {
    await seedAlerts(2, 5);
    const page = await listAlerts(db, userActor, {});
    expect(page.items.length).toBeGreaterThan(0);
  });
});
