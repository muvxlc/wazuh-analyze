import "dotenv/config";
import { loadConfig } from "../src/server/config";
import { createDatabase } from "../src/server/db/client";
import { hashPassword } from "../src/server/auth/password";
import * as schema from "../src/server/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);

  const email = process.argv[2] || "admin@wazuh-dashboard.local";
  const password = process.argv[3] || "dashboard";

  try {
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.normalizedEmail, email.toLowerCase())
    });

    if (existing) {
      console.log(`User ${email} already exists.`);
      return;
    }

    const passwordHash = await hashPassword(password);

    await db.insert(schema.users).values({
      email,
      normalizedEmail: email.toLowerCase(),
      displayName: "Super Admin",
      passwordHash,
      role: "super_admin",
      locale: "en",
      isActive: true,
    });

    console.log(`Created super_admin user: ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed to seed admin:", err);
  process.exit(1);
});
