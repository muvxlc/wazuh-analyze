import "server-only";

import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/types";
import { caseNotes } from "../db/schema";
import { ActorContext } from "../authorization/permissions";
import { requirePermission } from "../authorization/require";

export async function listCaseNotes(db: Database, incidentId: string) {
  return db.select().from(caseNotes).where(eq(caseNotes.incidentId, incidentId)).orderBy(asc(caseNotes.createdAt));
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
