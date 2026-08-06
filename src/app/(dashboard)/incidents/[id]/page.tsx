import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { currentUser } from "../../../../server/auth/current-user";
import { getIncidentDetail } from "../../../../server/incidents/query";
import { IncidentDetailView } from "../../../../components/incidents/incident-detail";
import { notFound, redirect } from "next/navigation";
import { PERMISSIONS } from "../../../../server/authorization/permissions";

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  let incident;
  let canManage = false;
  let canApprove = false;
  try {
    const user = await currentUser(db);
    if (!user || !user.permissions.has(PERMISSIONS.incidentsRead)) {
      redirect("/dashboard");
    }
    incident = await getIncidentDetail(
      db,
      { userId: user.id, role: user.role, permissions: new Set(user.permissions) },
      (await params).id,
    );
    canManage = user.permissions.has(PERMISSIONS.incidentsManage);
    canApprove = user.permissions.has(PERMISSIONS.actionsApprove as string);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("incident_not_found")) notFound();
    throw error;
  } finally {
    await pool.end();
  }
  return <IncidentDetailView initialIncident={incident!} canManage={canManage} canApprove={canApprove} />;
}
