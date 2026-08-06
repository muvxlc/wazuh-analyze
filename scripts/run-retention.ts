import "dotenv/config";
import { loadConfig } from "../src/server/config";
import { createDatabase } from "../src/server/db/client";
import { deleteExpiredAlerts } from "../src/server/maintenance/retention";

async function main() {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);

  try {
    const before = new Date();
    before.setDate(before.getDate() - config.alertRetentionDays);

    const count = await deleteExpiredAlerts(db, {
      before,
      batchSize: config.maintenanceBatchSize,
    });
    console.log(`Cleaned up ${count} expired alerts older than ${config.alertRetentionDays} days.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Alert retention cleanup failed:", err);
  process.exit(1);
});
