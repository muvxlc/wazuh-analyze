import type { NormalizedAlertInput } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeWazuhAlert(raw: unknown): NormalizedAlertInput {
  if (!isObject(raw)) {
    throw new Error("invalid Wazuh alert payload: expected object");
  }

  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) {
    throw new Error("missing wazuh id in alert payload");
  }

  const timestamp = raw.timestamp;
  if (typeof timestamp !== "string" || isNaN(new Date(timestamp).getTime())) {
    throw new Error("missing timestamp in alert payload");
  }

  const rule = raw.rule;
  if (!isObject(rule)) {
    throw new Error("missing rule in alert payload");
  }

  const ruleLevel = typeof rule.level === "number" ? rule.level : 0;
  const ruleId = typeof rule.id === "string" ? rule.id : null;
  const ruleDescription = typeof rule.description === "string" ? rule.description : "";

  const agent = raw.agent;
  const agentId = isObject(agent) && typeof agent.id === "string" ? agent.id : null;
  const agentName = isObject(agent) && typeof agent.name === "string" ? agent.name : null;
  const agentIp = isObject(agent) && typeof agent.ip === "string" ? agent.ip : null;
  const groups = isObject(agent) && Array.isArray(agent.groups)
    ? agent.groups.filter((g): g is string => typeof g === "string")
    : [];

  return {
    wazuhEventId: id,
    fingerprint: "", // computed separately by createAlertFingerprint
    wazuhTimestamp: new Date(timestamp),
    agentId,
    agentName,
    agentIp,
    ruleId,
    ruleDescription,
    level: ruleLevel,
    groups,
    compliance: isObject(rule.compliance) ? rule.compliance : {},
    rawPayload: raw,
  };
}
