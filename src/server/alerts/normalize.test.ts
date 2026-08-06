import { describe, expect, it } from "vitest";

import { normalizeWazuhAlert } from "./normalize";

const baseFixture = {
  id: "evt-abc-123",
  timestamp: "2026-08-02T10:00:00Z",
  rule: {
    level: 7,
    id: "100001",
    description: "SSH brute force attempt",
    groups: ["policy", "login"],
  },
  agent: {
    id: "001",
    name: "web-server-01",
    ip: "10.0.0.5",
  },
  full_log: "Failed password for root from 1.2.3.4 port 22",
} as const;

describe("normalizeWazuhAlert", () => {
  it("normalizes representative Wazuh fields", () => {
    const result = normalizeWazuhAlert(baseFixture);
    expect(result.wazuhEventId).toBe("evt-abc-123");
    expect(result.agentId).toBe("001");
    expect(result.agentName).toBe("web-server-01");
    expect(result.ruleId).toBe("100001");
    expect(result.level).toBe(7);
    expect(result.ruleDescription).toBe("SSH brute force attempt");
    expect(result.groups).toEqual(["policy", "login"]);
  });

  it("preserves validated raw JSONB payload", () => {
    const result = normalizeWazuhAlert(baseFixture);
    expect(result.rawPayload).toEqual(baseFixture);
  });

  it("does not throw on minimal Wazuh payload", () => {
    const minimal = {
      id: "evt-min-1",
      timestamp: "2026-08-02T00:00:00Z",
      rule: { level: 1, id: "1", description: "Minimal" },
    } as const;
    const result = normalizeWazuhAlert(minimal);
    expect(result.wazuhEventId).toBe("evt-min-1");
    expect(result.agentId).toBeNull();
    expect(result.agentName).toBeNull();
    expect(result.ruleId).toBe("1");
    expect(result.level).toBe(1);
    expect(result.groups).toEqual([]);
    expect(result.rawPayload).toEqual(minimal);
  });

  it("throws on missing id", () => {
    expect(() => normalizeWazuhAlert({})).toThrow("missing wazuh id");
  });

  it("throws on missing timestamp", () => {
    expect(() => normalizeWazuhAlert({ id: "x" })).toThrow("missing timestamp");
  });

  it("throws on missing rule", () => {
    expect(() => normalizeWazuhAlert({ id: "x", timestamp: "2026-01-01T00:00:00Z" })).toThrow("missing rule");
  });
});
