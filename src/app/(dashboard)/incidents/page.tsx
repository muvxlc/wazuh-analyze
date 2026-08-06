import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { currentUser } from "../../../server/auth/current-user";
import { PERMISSIONS } from "../../../server/authorization/permissions";
import { IncidentsClient } from "./incidents-client";
import { redirect } from "next/navigation";

export default async function IncidentsPage() {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await currentUser(db);
    if (!user || !user.permissions.has(PERMISSIONS.incidentsRead)) {
      redirect("/dashboard");
    }
    const canManage = user.permissions.has(PERMISSIONS.incidentsManage);
    return <IncidentsClient canManage={canManage} />;
  } finally {
    await pool.end();
  }
}
