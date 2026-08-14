import { PgBoss } from "pg-boss";
import { AppConfig } from "../config";

let boss: PgBoss | null = null;

export async function getPgBoss(config: AppConfig): Promise<PgBoss> {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: "boss",
    // Cap pool size: each pg-boss instance keeps its own pg pool; without a cap
    // a stray instance (dev HMR reload) leaks idle connections that accumulate
    // toward PG's max_connections ("too many clients").
    max: 5,
  });

  boss.on("error", (error: unknown) => console.error("[PgBoss]", error));

  await boss.start();
  console.log("[PgBoss] Started");
  return boss;
}

export async function stopPgBoss() {
  if (!boss) return;
  await boss.stop();
  boss = null;
  console.log("[PgBoss] Stopped");
}
