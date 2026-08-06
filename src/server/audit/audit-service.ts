import { eq } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/types";
import * as schema from "../db/schema";
import type { AuditEventInput } from "./types";

export async function writeAuditEvent(
  db: Database | DatabaseTransaction,
  event: AuditEventInput,
): Promise<void> {
  await db
    .insert(schema.auditEvents)
    .values({
      actorUserId: event.actorUserId,
      targetType: event.targetType,
      targetId: event.targetId,
      action: event.action,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      requestId: event.requestId,
      detail: event.detail,
    })
    .execute();
}
