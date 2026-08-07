import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { currentUser } from "../../../server/auth/current-user";
import { PERMISSIONS } from "../../../server/authorization/permissions";
import { AlertsClient } from "./alerts-client";
import { redirect } from "next/navigation";

export default async function AlertsPage() {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await currentUser(db);
    if (!user) {
      redirect("/login");
    }
    const canModify =
      user.permissions.has(PERMISSIONS.alertsAcknowledge) ||
      user.permissions.has(PERMISSIONS.alertsResolve);
    const canAnalyze = user.permissions.has(PERMISSIONS.alertsAnalyze);
    return <AlertsClient canModify={canModify} canAnalyze={canAnalyze} />;
  } finally {
    await pool.end();
  }
}
