import { describe, expect, it } from "vitest";
import { validateTag, AgentTagError } from "./agent-tags";

// Bulk database behavior is covered by integration routes; validation stays unit-scoped.

describe("agent-tags validation", () => {
  it("validates normal tags", () => {
    expect(validateTag("production")).toBe("production");
    expect(validateTag("server-01")).toBe("server-01");
    expect(validateTag("a/b/c")).toBe("a/b/c");
    expect(validateTag("env.prod")).toBe("env.prod");
  });

  it("trims whitespace", () => {
    expect(validateTag("  tag  ")).toBe("tag");
  });

  it("rejects empty string", () => {
    expect(() => validateTag("")).toThrow(AgentTagError);
    expect(() => validateTag("   ")).toThrow(AgentTagError);
  });

  it("rejects tags exceeding max length", () => {
    expect(() => validateTag("a".repeat(65))).toThrow(AgentTagError);
  });

  it("accepts tag at max length boundary", () => {
    expect(validateTag("a".repeat(64))).toBe("a".repeat(64));
  });

  it("rejects invalid characters", () => {
    expect(() => validateTag("tag with spaces")).toThrow(AgentTagError);
    expect(() => validateTag("tag@symbol")).toThrow(AgentTagError);
    expect(() => validateTag("tag!")).toThrow(AgentTagError);
    expect(() => validateTag("ป้าย")).toThrow(AgentTagError);
  });

  it("rejects non-string input", () => {
    expect(() => validateTag(null as unknown as string)).toThrow(AgentTagError);
    expect(() => validateTag(undefined as unknown as string)).toThrow(AgentTagError);
  });

  it("error has correct status code", () => {
    try {
      validateTag("");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentTagError);
      expect((err as AgentTagError).status).toBe(400);
      expect((err as AgentTagError).code).toBe("invalid_tag");
    }
  });
});
