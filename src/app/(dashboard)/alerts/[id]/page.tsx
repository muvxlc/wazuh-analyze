import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { currentUser } from "../../../../server/auth/current-user";
import { getAlertDetail } from "../../../../server/alerts/query";
import { AlertDetail } from "../../../../components/alerts/alert-detail";
import { notFound, redirect } from "next/navigation";

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const config = loadConfig(process.env); const { db, pool } = createDatabase(config.databaseUrl);
  let alert;
  try {
    const user = await currentUser(db);
    if (!user) redirect("/login");
    alert = await getAlertDetail(db, { userId: user.id, role: user.role, permissions: new Set(user.permissions) }, (await params).id);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("alert not found")) notFound();
    throw error;
  } finally { await pool.end(); }
  return <AlertDetail alert={alert!} />;
}
