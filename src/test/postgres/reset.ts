import type { Pool } from "pg";

export const applicationTables = [
  "alert_events",
  "permission_overrides",
  "role_permission_overrides",
  "sessions",
  "invites",
  "audit_events",
  "alerts",
  "agent_snapshots",
  "agent_tags",
  "system_settings",
  "webhook_replay_keys",
  "users",
] as const;

export async function resetTestDatabase(
  pool: Pool,
): Promise<void> {
  const connectionString = pool.options.connectionString;

  if (!connectionString) {
    throw new Error("Refusing to reset a database without an explicit URL");
  }

  const databaseName = new URL(connectionString).pathname.slice(1);

  if (!databaseName.includes("_test")) {
    throw new Error("Refusing to reset a database without _test in its name");
  }

  await pool.query(
    `TRUNCATE TABLE ${applicationTables.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );

  // Drop any test-only constraints left by prior tests (e.g. task3_rollback_test)
  await pool.query(
    `ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "task3_rollback_test"`,
  );
}
