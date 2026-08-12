import { sql } from "drizzle-orm";
import type { Database } from "../db/types";

export interface MitreTechnique {
  techniqueId: string;
  techniqueName: string | null;
  tactic: string | null;
  count: number;
}

export async function listMitreTechniques(db: Database, range: string): Promise<MitreTechnique[]> {
  const interval = range === "7d" ? "7 days" : range === "90d" ? "90 days" : "30 days";
  const result = await db.execute<{
    technique_id: string;
    technique_name: string | null;
    tactic: string | null;
    count: number;
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (alert_id) verdict
      FROM alert_analyses
      WHERE created_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
      ORDER BY alert_id, created_at DESC
    )
    SELECT
      m.elem->>'techniqueId' AS technique_id,
      MAX(m.elem->>'techniqueName') AS technique_name,
      MAX(m.elem->>'tactic') AS tactic,
      COUNT(*)::int AS count
    FROM latest, jsonb_array_elements(latest.verdict->'mitreAttack') AS m(elem)
    WHERE m.elem->>'techniqueId' IS NOT NULL
      AND m.elem->>'techniqueId' <> ''
    GROUP BY technique_id
    ORDER BY count DESC, technique_id
  `);
  return result.rows.map((r) => ({
    techniqueId: r.technique_id,
    techniqueName: r.technique_name,
    tactic: r.tactic,
    count: Number(r.count),
  }));
}
