import type { alertStatusEnum, alerts, alertEvents } from "../db/schema";
import type { InferModel } from "drizzle-orm";

export type AlertStatus = typeof alertStatusEnum.enumValues[number];

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
}

export interface AlertPage {
  items: AlertRecord[];
  cursor: string | null;
  hasNext: boolean;
}
