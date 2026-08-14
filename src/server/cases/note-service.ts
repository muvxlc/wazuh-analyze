import "server-only";

import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/types";
import { caseNotes } from "../db/schema";
import { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";
import { fetchUserNames } from "../incidents/query";

export async function listCaseNotes(db: Database, incidentId: string) {
  const rows = await db.select().from(caseNotes).where(eq(caseNotes.incidentId, incidentId)).orderBy(asc(caseNotes.createdAt));
  const nameMap = await fetchUserNames(db, rows.map((r) => r.authorUserId).filter((v): v is string => Boolean(v)));
  return rows.map((r) => ({ ...r, authorDisplayName: r.authorUserId ? nameMap.get(r.authorUserId) ?? null : null }));
}

export async function addCaseNote(db: Database, actor: ActorContext, incidentId: string, body: string) {
  requirePermission(actor.permissions, "incidents.manage");
  const [note] = await db.insert(caseNotes).values({
    incidentId,
    authorUserId: actor.userId,
    body,
  }).returning();
  return note;
}
