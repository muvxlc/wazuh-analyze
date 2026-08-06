import type { incidents, incidentEvents } from "../db/schema";
import type { InferSelectModel } from "drizzle-orm";

export type IncidentStatus = "open" | "investigating" | "mitigated" | "resolved";

export type IncidentRow = InferSelectModel<typeof incidents>;
export type IncidentEventRow = InferSelectModel<typeof incidentEvents>;

export interface IncidentDetail extends Omit<IncidentRow, "status"> {
  status: IncidentStatus;
  timeline: Array<{
    id: string;
    fromStatus: IncidentStatus | null;
    toStatus: IncidentStatus;
    actorUserId: string | null;
    occurredAt: Date;
    metadata: Record<string, unknown>;
  }>;
  alerts?: Array<{
    incidentId: string;
    alertId: string;
    addedAt: Date;
  }>;
}
