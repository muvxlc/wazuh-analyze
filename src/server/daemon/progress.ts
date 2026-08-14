import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/types";
import { queueProgress } from "../db/schema";

export type QueuePhase = "queued" | "loading" | "processing" | "completed" | "failed";

export interface QueueProgressRow {
  phase: QueuePhase;
  status: string;
  jobId?: string;
  detail?: string;
  updatedAt: Date;
}

export async function getQueuePhase(
  db: Database,
  queueName: string,
  entityId: string,
): Promise<QueueProgressRow | null> {
  const [row] = await db
    .select({
      phase: queueProgress.phase,
      status: queueProgress.status,
      jobId: queueProgress.jobId,
      detail: queueProgress.detail,
      updatedAt: queueProgress.updatedAt,
    })
    .from(queueProgress)
    .where(and(eq(queueProgress.queueName, queueName), eq(queueProgress.entityId, entityId)))
    .orderBy(desc(queueProgress.updatedAt))
    .limit(1);
  return (row as QueueProgressRow | null) ?? null;
}

export async function setQueuePhase(
  db: Database,
  queueName: string,
  entityId: string,
  phase: QueuePhase,
  options: { jobId?: string; detail?: string } = {},
): Promise<void> {
  const [current] = await db
    .select({ id: queueProgress.id })
    .from(queueProgress)
    .where(and(eq(queueProgress.queueName, queueName), eq(queueProgress.entityId, entityId)))
    .orderBy(desc(queueProgress.updatedAt))
    .limit(1);

  const values = {
    queueName,
    entityId,
    jobId: options.jobId,
    phase,
    status: phase === "completed" ? "done" : phase === "failed" ? "error" : "running",
    detail: options.detail,
    updatedAt: new Date(),
  };

  if (current) {
    await db.update(queueProgress).set(values).where(eq(queueProgress.id, current.id));
  } else {
    await db.insert(queueProgress).values({ ...values, startedAt: new Date() });
  }
}
