import { describe, expect, it } from "vitest";
import { createAlertFingerprint } from "./fingerprint";

describe("createAlertFingerprint", () => {
  it("produces a deterministic SHA-256 hex string", () => {
    const input = {
      wazuhEventId: "evt-1",
      fingerprint: "",
      wazuhTimestamp: new Date("2026-08-02T10:00:00Z"),
      agentId: "001",
      agentName: "host-a",
      agentIp: null,
      ruleId: "100001",
      ruleDescription: "SSH brute force",
      level: 7,
      groups: ["policy"],
      compliance: {},
      rawPayload: { decoder: "syslog", location: "auth" },
    };
    const fp = createAlertFingerprint(input);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns same fingerprint for semantically equal inputs", () => {
    const base = {
      wazuhEventId: "evt-2",
      fingerprint: "",
      wazuhTimestamp: new Date("2026-08-02T10:00:00Z"),
      agentId: "002",
      agentName: "host-b",
      agentIp: null,
      ruleId: "200002",
      ruleDescription: "Firewall drop",
      level: 3,
      groups: [],
      compliance: {},
      rawPayload: {},
    };
    expect(createAlertFingerprint(base)).toBe(createAlertFingerprint(base));
  });

  it("includes decoder and location from rawPayload when present", () => {
    const a = {
      wazuhEventId: "evt-3",
      fingerprint: "",
      wazuhTimestamp: new Date("2026-08-02T10:00:00Z"),
      agentId: "003",
      agentName: "host-c",
      agentIp: null,
      ruleId: "300003",
      ruleDescription: "Test alert",
      level: 5,
      groups: [],
      compliance: {},
      rawPayload: { decoder: "json", location: "api" },
    };
    const b = {
      wazuhEventId: "evt-3",
      fingerprint: "",
      wazuhTimestamp: new Date("2026-08-02T10:00:00Z"),
      agentId: "003",
      agentName: "host-c",
      agentIp: null,
      ruleId: "300003",
      ruleDescription: "Test alert",
      level: 5,
      groups: [],
      compliance: {},
      rawPayload: { decoder: "json", location: "api" },
    };
    expect(createAlertFingerprint(a)).toBe(createAlertFingerprint(b));
  });
});
