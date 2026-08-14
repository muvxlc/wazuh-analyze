import { describe, expect, it } from "vitest";

import {
  buildEvidence,
  evidenceIdentityKey,
  parseEvidence,
  EvidenceError,
  MAX_STRING_LENGTH,
  MAX_SOURCE_ID_LENGTH,
  MAX_FIELDS_BYTES,
} from "./unified-evidence";
import type { Evidence, EvidenceProvenance } from "./unified-evidence";

const VALID_PROVENANCE: EvidenceProvenance[] = ["webhook", "api", "indexer", "manual", "integration"];

const BASE: Parameters<typeof buildEvidence>[0] = {
  source: "wazuh-webhook",
  sourceId: "evt-abc123",
  entityType: "alert",
  agentId: "001",
  eventTime: "2024-06-15T10:30:00.000Z",
  provenance: "webhook",
  fields: { rule: "1001", description: "SSH brute force" },
};

describe("parseEvidence", () => {
  it("parses valid evidence", () => {
    const ev: Evidence = {
      source: "api",
      sourceId: "x",
      entityType: "vuln",
      agentId: "002",
      eventTime: "2024-01-01T00:00:00Z",
      retrievedAt: "2024-01-01T00:01:00Z",
      provenance: "api",
      fields: {},
    };
    expect(parseEvidence(ev)).toEqual(ev);
  });

  it("rejects missing required fields", () => {
    expect(() => parseEvidence({})).toThrow(EvidenceError);
    expect(() => parseEvidence({ ...BASE, source: "" })).toThrow(EvidenceError);
    expect(() => parseEvidence({ ...BASE, sourceId: "   " })).toThrow(EvidenceError);
  });

  it("rejects invalid datetime", () => {
    expect(() => parseEvidence({ ...BASE, eventTime: "not-a-date" })).toThrow(EvidenceError);
    expect(() => parseEvidence({ ...BASE, retrievedAt: "bad" })).toThrow(EvidenceError);
  });

  it("rejects unknown provenance values", () => {
    expect(() => parseEvidence({ ...BASE, provenance: "unknown" as EvidenceProvenance })).toThrow(EvidenceError);
  });

  it("accepts all defined provenance values", () => {
    for (const prov of VALID_PROVENANCE) {
      const ev = parseEvidence({ ...BASE, provenance: prov });
      expect(ev.provenance).toBe(prov);
    }
  });

  it("accepts fields with string/number/boolean/null values", () => {
    const raw = {
      ...BASE,
      fields: { a: "str", b: 1, c: true, d: null },
    };
    expect(parseEvidence(raw).fields).toEqual(raw.fields);
  });

  it("rejects non-primitive field values", () => {
    const raw = {
      ...BASE,
      fields: { safe: "ok", bad: { nested: true } as unknown as string },
    };
    expect(() => parseEvidence(raw)).toThrow(EvidenceError);
  });
});

describe("buildEvidence", () => {
  it("builds valid evidence from raw input", () => {
    const ev = buildEvidence(BASE);
    expect(ev.source).toBe("wazuh-webhook");
    expect(ev.sourceId).toBe("evt-abc123");
    expect(ev.entityType).toBe("alert");
    expect(ev.agentId).toBe("001");
    expect(ev.provenance).toBe("webhook");
  });

  it("coerces eventTime from Date object", () => {
    const d = new Date("2024-03-01T12:00:00Z");
    const ev = buildEvidence({ ...BASE, eventTime: d });
    expect(ev.eventTime).toBe(d.toISOString());
  });

  it("defaults retrievedAt to now when absent", () => {
    const before = new Date();
    const ev = buildEvidence({ ...BASE, retrievedAt: undefined });
    const after = new Date();
    expect(new Date(ev.retrievedAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(new Date(ev.retrievedAt).getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("rejects empty source/sourceId/entityType/agentId", () => {
    expect(() => buildEvidence({ ...BASE, source: "" })).toThrow(EvidenceError);
    expect(() => buildEvidence({ ...BASE, sourceId: "" })).toThrow(EvidenceError);
    expect(() => buildEvidence({ ...BASE, entityType: "   " })).toThrow(EvidenceError);
    expect(() => buildEvidence({ ...BASE, agentId: null as unknown as string })).toThrow(EvidenceError);
  });

  it("rejects unparseable datetime", () => {
    expect(() => buildEvidence({ ...BASE, eventTime: "garbage" })).toThrow(EvidenceError);
    expect(() => buildEvidence({ ...BASE, eventTime: new Date("invalid") })).toThrow(EvidenceError);
  });
});

describe("bounds", () => {
  it("truncates source to MAX_STRING_LENGTH", () => {
    const long = "a".repeat(MAX_STRING_LENGTH + 100);
    const ev = buildEvidence({ ...BASE, source: long });
    expect(ev.source).toHaveLength(MAX_STRING_LENGTH);
  });

  it("truncates sourceId to MAX_SOURCE_ID_LENGTH", () => {
    const long = "b".repeat(MAX_SOURCE_ID_LENGTH + 50);
    const ev = buildEvidence({ ...BASE, sourceId: long });
    expect(ev.sourceId).toHaveLength(MAX_SOURCE_ID_LENGTH);
  });

  it("truncates agentId to MAX_SOURCE_ID_LENGTH", () => {
    const long = "c".repeat(MAX_SOURCE_ID_LENGTH + 50);
    const ev = buildEvidence({ ...BASE, agentId: long });
    expect(ev.agentId).toHaveLength(MAX_SOURCE_ID_LENGTH);
  });

  it("trims whitespace from all string fields", () => {
    const ev = buildEvidence({
      ...BASE,
      source: "  wazuh  ",
      sourceId: "  id-1  ",
      entityType: "  alert  ",
      agentId: "  001  ",
    });
    expect(ev.source).toBe("wazuh");
    expect(ev.sourceId).toBe("id-1");
    expect(ev.entityType).toBe("alert");
    expect(ev.agentId).toBe("001");
  });

  it("truncates fields JSON bytes to MAX_FIELDS_BYTES", () => {
    const bigValue = "x".repeat(MAX_FIELDS_BYTES + 1000);
    const ev = buildEvidence({ ...BASE, fields: { huge: bigValue } });
    expect(JSON.stringify(ev.fields).length).toBeLessThanOrEqual(MAX_FIELDS_BYTES);
  });
});

describe("redaction", () => {
  it("redacts api_key fields", () => {
    const ev = buildEvidence({ ...BASE, fields: { api_key: "secret123", normal: "value" } });
    expect(ev.fields.api_key).toBe("[REDACTED]");
    expect(ev.fields.normal).toBe("value");
  });

  it("redacts password/passwd fields", () => {
    const ev = buildEvidence({ ...BASE, fields: { password: "pass", passwd: "p", normal: 1 } });
    expect(ev.fields.password).toBe("[REDACTED]");
    expect(ev.fields.passwd).toBe("[REDACTED]");
    expect(ev.fields.normal).toBe(1);
  });

  it("redacts token-related keys", () => {
    const ev = buildEvidence({ ...BASE, fields: { auth_token: "tok", access_token: "at", normal: "ok" } });
    expect(ev.fields.auth_token).toBe("[REDACTED]");
    expect(ev.fields.access_token).toBe("[REDACTED]");
    expect(ev.fields.normal).toBe("ok");
  });

  it("is case-insensitive for redaction keys", () => {
    const ev = buildEvidence({ ...BASE, fields: { API_KEY: "k", Password: "p" } });
    expect(ev.fields.API_KEY).toBe("[REDACTED]");
    expect(ev.fields.Password).toBe("[REDACTED]");
  });

  it("leaves safe keys untouched", () => {
    const ev = buildEvidence({ ...BASE, fields: { description: "test", count: 5, active: true } });
    expect(ev.fields).toEqual({ description: "test", count: 5, active: true });
  });

  it("drops fields with non-serializable values after redaction pass", () => {
    const ev = buildEvidence({ ...BASE, fields: { api_key: { nested: true } as unknown as string, safe: "keep" } });
    expect(ev.fields.api_key).toBeUndefined();
    expect(ev.fields.safe).toBe("keep");
  });
});

describe("evidenceIdentityKey", () => {
  it("produces deterministic key from core fields", () => {
    const ev1 = buildEvidence(BASE);
    const ev2 = buildEvidence({ ...BASE, eventTime: "2025-01-01T00:00:00Z", fields: { different: true } });
    expect(evidenceIdentityKey(ev1)).toBe(evidenceIdentityKey(ev2));
  });

  it("differs when source differs", () => {
    const a = buildEvidence({ ...BASE, source: "src-a" });
    const b = buildEvidence({ ...BASE, source: "src-b" });
    expect(evidenceIdentityKey(a)).not.toBe(evidenceIdentityKey(b));
  });

  it("differs when agentId differs", () => {
    const a = buildEvidence({ ...BASE, agentId: "001" });
    const b = buildEvidence({ ...BASE, agentId: "002" });
    expect(evidenceIdentityKey(a)).not.toBe(evidenceIdentityKey(b));
  });
});

describe("malformed inputs", () => {
  it("throws on non-string source", () => {
    expect(() => parseEvidence({ ...BASE, source: 123 as unknown as string })).toThrow(EvidenceError);
  });

  it("throws on null input", () => {
    expect(() => parseEvidence(null)).toThrow(EvidenceError);
  });

  it("throws on array input", () => {
    expect(() => parseEvidence([])).toThrow(EvidenceError);
  });
});
