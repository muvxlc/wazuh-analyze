import "dotenv/config";
import { Pool } from "pg";
import { resetTestDatabase } from "../src/test/postgres/reset";

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await resetTestDatabase(pool);
    console.log("Test database reset complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Test database reset failed:", err);
  process.exit(1);
});
