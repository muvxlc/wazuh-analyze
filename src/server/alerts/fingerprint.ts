import { createHash } from "node:crypto";

import type { NormalizedAlertInput } from "./types";

export function createAlertFingerprint(alert: NormalizedAlertInput): string {
  const parts: string[] = [];

  // Fixed key order for determinism
  parts.push(`ts:${alert.wazuhTimestamp.toISOString()}`);
  parts.push(`agent_id:${alert.agentId ?? ""}`);
  parts.push(`agent_name:${alert.agentName ?? ""}`);
  parts.push(`rule_id:${alert.ruleId ?? ""}`);
  parts.push(`level:${alert.level}`);
  parts.push(`decoder:${alert.rawPayload && typeof (alert.rawPayload as Record<string, unknown>)["decoder"] === "string" ? (alert.rawPayload as Record<string, unknown>)["decoder"] : ""}`);
  parts.push(`location:${alert.rawPayload && typeof (alert.rawPayload as Record<string, unknown>)["location"] === "string" ? (alert.rawPayload as Record<string, unknown>)["location"] : ""}`);

  const canonical = parts.join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
