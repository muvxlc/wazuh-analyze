import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";

export interface CorrelateResult {
  incidentId: string;
  created: boolean;
}

// ponytail: 60min rolling correlation per agent+rule for actionable alerts (level >= 7). Uses transaction advisory lock to eliminate concurrent deduplication race conditions without retry loops.
export async function correlateAlert(
  db: Database,
  alertId: string,
): Promise<CorrelateResult | null> {
  const [alert] = await db
    .select()
    .from(schema.alerts)
    .where(eq(schema.alerts.id, alertId))
    .limit(1);

  if (!alert || alert.level < 7) {
    return null;
  }

  const agentId = alert.agentId ?? "unknown-agent";
  const ruleId = alert.ruleId ?? "unknown-rule";
  const windowStart = new Date(alert.wazuhTimestamp.getTime() - 60 * 60 * 1000);
  const lockKey = `incident:${agentId}:${ruleId}`;

  return db.transaction(async (tx) => {
    // Transaction advisory lock guarantees serial execution per (agent, rule) pair across concurrent workers.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    // FOR UPDATE locks existing matching incident row if present.
    const [existing] = await tx
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.agentId, agentId),
          eq(schema.incidents.ruleId, ruleId),
          ne(schema.incidents.status, "resolved"),
          gte(schema.incidents.createdAt, windowStart),
        ),
      )
      .orderBy(desc(schema.incidents.createdAt))
      .limit(1)
      .for("update");

    // Anchor incident timestamps on the triggering alert's wazuh timestamp so the 60min
    // window comparison stays on one time base (also correct for backfilled alerts).
    const ts = alert.wazuhTimestamp;

    if (existing) {
      await tx
        .insert(schema.incidentAlerts)
        .values({
          incidentId: existing.id,
          alertId: alert.id,
          addedAt: ts,
        })
        .onConflictDoNothing({ target: [schema.incidentAlerts.incidentId, schema.incidentAlerts.alertId] });

      await tx
        .update(schema.incidents)
        .set({ updatedAt: ts })
        .where(eq(schema.incidents.id, existing.id));

      return { incidentId: existing.id, created: false };
    }

    const severity = alert.level >= 12 ? "high" : alert.level >= 9 ? "medium" : "low";
    const title = `Alert [${ruleId}]: ${alert.ruleDescription} (${alert.agentName ?? agentId})`;

    const [newIncident] = await tx
      .insert(schema.incidents)
      .values({
        title,
        status: "open",
        severity,
        agentId,
        ruleId,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: schema.incidents.id });

    if (!newIncident) {
      throw new Error("Failed to create incident");
    }

    await tx.insert(schema.incidentAlerts).values({
      incidentId: newIncident.id,
      alertId: alert.id,
      addedAt: ts,
    });

    await tx.insert(schema.incidentEvents).values({
      incidentId: newIncident.id,
      toStatus: "open",
      occurredAt: ts,
      metadata: { reason: "correlator_created", firstAlertId: alert.id },
    });

    return { incidentId: newIncident.id, created: true };
  });
}
