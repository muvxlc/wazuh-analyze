import type { alertStatusEnum, alerts, alertEvents } from "../db/schema";
import type { InferModel } from "drizzle-orm";

export type AlertStatus = typeof alertStatusEnum.enumValues[number];

// ponytail: shared with Feature 2 NEW badge threshold (relative-time.ts)
export const DEFAULT_GROUP_WINDOW_MINUTES = 15;

export interface AlertRecord {
  id: string;
  wazuhEventId: string | null;
  fingerprint: string;
  wazuhTimestamp: Date;
  ingestedAt: Date;
  agentId: string | null;
  agentName: string | null;
  agentIp: string | null;
  ruleId: string | null;
  ruleDescription: string;
  level: number;
  groups: string[];
  tags: string[];
  compliance: Record<string, unknown>;
  status: AlertStatus;
  acknowledgedAt: Date | null;
  acknowledgedByUserId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  rawPayload: unknown;
}

export interface AlertDetail extends AlertRecord {
  timeline: Array<{
    id: string;
    fromStatus: AlertStatus | null;
    toStatus: AlertStatus;
    actorUserId: string | null;
    occurredAt: Date;
    metadata: Record<string, unknown>;
  }>;
}

export interface NormalizedAlertInput {
  wazuhEventId: string | null;
  fingerprint: string;
  wazuhTimestamp: Date;
  agentId: string | null;
  agentName: string | null;
  agentIp: string | null;
  ruleId: string | null;
  ruleDescription: string;
  level: number;
  groups: string[];
  compliance: Record<string, unknown>;
  rawPayload: unknown;
}

export interface AlertListQuery {
  search?: string;
  agentId?: string;
  agentIds?: string[];
  ruleId?: string;
  levelMin?: number;
  levelMax?: number;
  status?: AlertStatus;
  groups?: string[];
  tags?: string[];
  cursor?: string;
  limit?: number;
  group?: boolean;
  windowMinutes?: number;
  since?: Date;
  until?: Date;
}

export interface AlertPage {
  items: AlertRecord[];
  cursor: string | null;
  hasNext: boolean;
}

export interface AlertGroupRow {
  key: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  level: number;
  agentId: string | null;
  agentName: string | null;
  ruleId: string | null;
  ruleDescription: string;
  status: AlertStatus;
  representativeAlertId: string;
  incidentCount: number;
  openIncidentId: string | null;
}

export interface AlertGroupPage {
  groups: AlertGroupRow[];
  cursor: string | null;
  hasNext: boolean;
}
