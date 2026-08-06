import "dotenv/config";
import { createDatabase } from "../src/server/db/client";
import { hashPassword } from "../src/server/auth/password";
import * as schema from "../src/server/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL in environment");
  const { db, pool } = createDatabase(url);

  const email = process.argv[2] || "admin@wazuh-dashboard.local";
  const password = process.argv[3] || "SuperAdmin123!";

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

    console.log(`Created super_admin user successfully:`);
    console.log(`Email: ${email}`);
    console.log(`PLEASE LOG IN AND CHANGE YOUR PASSWORD IMMEDIATELY.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed to seed admin:", err);
  process.exit(1);
});
