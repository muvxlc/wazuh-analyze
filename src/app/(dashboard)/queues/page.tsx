import { QueuesClient } from "./queues-client";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../../../server/auth/cookies";

export default async function QueuesPage() {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  let canManage = false;

  try {
    const c = await cookies();
    const token = c.get(SESSION_COOKIE)?.value ?? null;
    const user = await authenticateRequest(db, token);
    canManage = user.permissions.has("queues.manage") || user.role === "super_admin" || user.role === "admin";
  } catch (err) {
    // Unauthenticated handled by middleware
  } finally {
    await pool.end();
  }

  return <QueuesClient canManage={canManage} />;
}
