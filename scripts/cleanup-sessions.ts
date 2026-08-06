import "dotenv/config";
import { loadConfig } from "../src/server/config";
import { createDatabase } from "../src/server/db/client";
import { cleanupExpiredSessions } from "../src/server/maintenance/session-cleanup";

async function main() {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);

  try {
    const before = new Date();
    const count = await cleanupExpiredSessions(db, {
      before,
      batchSize: config.maintenanceBatchSize,
    });
    console.log(`Cleaned up ${count} expired sessions.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Session cleanup failed:", err);
  process.exit(1);
});
