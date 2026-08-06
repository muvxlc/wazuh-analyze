import "server-only";

import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Database, DatabaseTransaction } from "../db/types";
import type { EncryptedPayload } from "./encryption";
import type { SystemSettingKey } from "./types";

export async function getSettingByKey(
  db: Database,
  key: SystemSettingKey,
): Promise<{ value: EncryptedPayload | null; updatedByUserId: string | null; updatedAt: Date } | null> {
  const [row] = await db
    .select({
      value: schema.systemSettings.value,
      updatedByUserId: schema.systemSettings.updatedByUserId,
      updatedAt: schema.systemSettings.updatedAt,
    })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  return (row as { value: EncryptedPayload | null; updatedByUserId: string | null; updatedAt: Date }) ?? null;
}

export async function upsertSetting(
  db: Database | DatabaseTransaction,
  key: SystemSettingKey,
  payload: EncryptedPayload | null,
  updatedByUserId: string | null,
): Promise<void> {
  await db
    .insert(schema.systemSettings)
    .values({
      key,
      value: payload ?? {},
      updatedByUserId,
    })
    .onConflictDoUpdate({
      target: schema.systemSettings.key,
      set: {
        value: payload ?? {},
        updatedByUserId,
        updatedAt: new Date(),
      },
    })
    .execute();
}

export async function listAllSettings(
  db: Database,
): Promise<Array<{ key: string; value: EncryptedPayload | null; updatedByUserId: string | null; updatedAt: Date }>> {
  const rows = await db
    .select({
      key: schema.systemSettings.key,
      value: schema.systemSettings.value,
      updatedByUserId: schema.systemSettings.updatedByUserId,
      updatedAt: schema.systemSettings.updatedAt,
    })
    .from(schema.systemSettings)
    .orderBy(schema.systemSettings.key);
  return rows as Array<{ key: string; value: EncryptedPayload | null; updatedByUserId: string | null; updatedAt: Date }>;
}
