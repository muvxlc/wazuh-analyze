import { describe, expect, it } from "vitest";

import { buildSignatureKey } from "./signature";

describe("buildSignatureKey", () => {
  it("concatenates ruleId, agentId, level with pipe separators", () => {
    expect(buildSignatureKey("87100", "001", 7)).toBe("87100|001|7");
  });

  it("uses literal '*' for null agentId", () => {
    expect(buildSignatureKey("87100", null, 7)).toBe("87100|*|7");
  });

  it("returns null for null ruleId (no signature without a rule)", () => {
    expect(buildSignatureKey(null, "001", 7)).toBeNull();
  });

  it("returns null for empty-string ruleId", () => {
    expect(buildSignatureKey("", "001", 7)).toBeNull();
  });

  it("returns null when both ruleId and agentId are null", () => {
    expect(buildSignatureKey(null, null, 7)).toBeNull();
  });

  it("embeds level as a number in the string", () => {
    const key = buildSignatureKey("87100", "001", 12);
    expect(key).toBe("87100|001|12");
    // level segment parses back to a number
    expect(Number(key!.split("|")[2])).toBe(12);
  });

  it("never includes srcip (only ruleId|agentId|level)", () => {
    const key = buildSignatureKey("87100", "001", 7);
    expect(key).toBe("87100|001|7");
    // exactly 2 pipes => 3 segments, no srcip slot
    expect(key!.split("|")).toHaveLength(3);
  });

  it("preserves agentId empty string as-is (not coerced to '*')", () => {
    // only null agentId => "*"; empty string is an explicit value
    expect(buildSignatureKey("87100", "", 7)).toBe("87100||7");
  });
});
