import { PgBoss } from "pg-boss";
import { AppConfig } from "../config";

let boss: PgBoss | null = null;

export async function getPgBoss(config: AppConfig): Promise<PgBoss> {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: "boss",
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
