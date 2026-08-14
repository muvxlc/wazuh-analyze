import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { listIncidents } from "./query";
import type { ActorContext } from "../authorization/permissions";

const ACTOR: ActorContext = {
  userId: "test-actor",
  role: "admin",
  permissions: new Set(["incidents.list", "incidents.read", "incidents.manage"]),
};

describe("incidents query (integration)", () => {
  const pool = createTestPool();
  const db = drizzle(pool, { schema });

  beforeAll(async () => {
    await resetTestDatabase(pool);
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertIncident(opts: {
    title: string;
    status?: "open" | "investigating" | "mitigated" | "resolved";
    severity?: string;
    agentId?: string;
    ruleId?: string;
    incidentNumber?: string;
    daysAgo?: number;
  }): Promise<string> {
    const created = new Date();
    if (opts.daysAgo) created.setDate(created.getDate() - opts.daysAgo);
    const [row] = await db
      .insert(schema.incidents)
      .values({
        title: opts.title,
        status: opts.status ?? "open",
        severity: opts.severity ?? "medium",
        agentId: opts.agentId ?? null,
        ruleId: opts.ruleId ?? null,
        incidentNumber: opts.incidentNumber ?? null,
        createdAt: created,
        updatedAt: created,
        closedAt: opts.status === "resolved" ? created : null,
      })
      .returning({ id: schema.incidents.id });
    return row!.id;
  }

  it("returns resolved incidents when no status filter (they are not deleted)", async () => {
    await insertIncident({ title: "active one", status: "open" });
    await insertIncident({ title: "done one", status: "resolved" });

    const page = await listIncidents(db, ACTOR, {});
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.status).sort()).toEqual(["open", "resolved"]);
  });

  it("filters by status", async () => {
    await insertIncident({ title: "a", status: "open" });
    await insertIncident({ title: "b", status: "resolved" });

    const page = await listIncidents(db, ACTOR, { status: "resolved" });
    expect(page.total).toBe(1);
    expect(page.items[0].title).toBe("b");
    expect(page.items[0].closedAt).not.toBeNull();
  });

  it("paginates with limit/offset and reports total", async () => {
    for (let i = 0; i < 5; i++) {
      await insertIncident({ title: `bulk-${i}`, daysAgo: i });
    }
    const first = await listIncidents(db, ACTOR, { limit: 2, offset: 0 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);

    const second = await listIncidents(db, ACTOR, { limit: 2, offset: 2 });
    expect(second.items).toHaveLength(2);

    // Ensure no row overlap between pages.
    const firstIds = new Set(first.items.map((i) => i.id));
    expect(second.items.every((i) => !firstIds.has(i.id))).toBe(true);
  });

  it("searches title and incident number", async () => {
    await insertIncident({ title: "SSH brute force", incidentNumber: "IR001" });
    await insertIncident({ title: "unrelated noise" });

    const byTitle = await listIncidents(db, ACTOR, { q: "brute" });
    expect(byTitle.total).toBe(1);
    expect(byTitle.items[0].title).toBe("SSH brute force");

    const byNumber = await listIncidents(db, ACTOR, { q: "IR001" });
    expect(byNumber.total).toBe(1);
  });
});
