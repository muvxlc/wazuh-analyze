import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE, resolvePromptTemplate } from "./prompt-templates";

describe("resolvePromptTemplate", () => {
  it("returns the auth template for an sshd group", () => {
    const t = resolvePromptTemplate(["sshd"]);
    expect(t).not.toBe(DEFAULT_TEMPLATE);
    expect(t.guidance.toLowerCase()).toContain("ssh");
    expect(t.system).toContain("SSH session analysis");
  });

  it("returns the auth template for an authentication group", () => {
    const t = resolvePromptTemplate(["authentication_failed"]);
    expect(t.guidance.toLowerCase()).toContain("login");
  });

  it("returns the web template for web + injection groups", () => {
    const t = resolvePromptTemplate(["web", "injection"]);
    expect(t.guidance.toLowerCase()).toContain("injection");
    expect(t.system).toContain("web application attack analysis");
  });

  it("returns DEFAULT_TEMPLATE (empty guidance) for empty groups", () => {
    expect(resolvePromptTemplate([])).toBe(DEFAULT_TEMPLATE);
    expect(DEFAULT_TEMPLATE.guidance).toBe("");
  });

  it("returns DEFAULT_TEMPLATE when no keyword matches", () => {
    expect(resolvePromptTemplate(["core", "ossec"])).toBe(DEFAULT_TEMPLATE);
  });

  it("matches case-insensitively", () => {
    const t = resolvePromptTemplate(["SSHD"]);
    expect(t).not.toBe(DEFAULT_TEMPLATE);
    expect(t.guidance.toLowerCase()).toContain("ssh");
  });

  it("returns the malware template for a yara group", () => {
    const t = resolvePromptTemplate(["yara"]);
    expect(t).not.toBe(DEFAULT_TEMPLATE);
    expect(t.system.toLowerCase()).toContain("malware");
  });

  it("returns the fim template for a syscheck group", () => {
    const t = resolvePromptTemplate(["syscheck"]);
    expect(t).not.toBe(DEFAULT_TEMPLATE);
    expect(t.system.toLowerCase()).toContain("file integrity");
  });

  it("returns the policy template for an sca group", () => {
    const t = resolvePromptTemplate(["sca"]);
    expect(t).not.toBe(DEFAULT_TEMPLATE);
    expect(t.guidance.toLowerCase()).toContain("cis");
  });

  it("returns the vuln template for a cve group (and it_hygiene bucket)", () => {
    expect(resolvePromptTemplate(["cve"]).system.toLowerCase()).toContain("vulnerability");
    // it_hygiene shares the vuln bucket (parity with recipe.ts).
    expect(resolvePromptTemplate(["it_hygiene"]).system.toLowerCase()).toContain("vulnerability");
  });

  it("returns DEFAULT_TEMPLATE for nullish groups without throwing", () => {
    expect(resolvePromptTemplate(undefined as unknown as string[])).toBe(DEFAULT_TEMPLATE);
  });

  // First-match priority order (mirrors src/server/enrichment/recipe.ts buckets):
  //   auth > malware > fim > policy > vuln > web
  // On a multi-category overlap the earlier bucket wins.
  it("resolves multi-category overlap deterministically (auth before web)", () => {
    const t = resolvePromptTemplate(["sshd", "web"]);
    expect(t.guidance.toLowerCase()).toContain("ssh");
    expect(t.guidance.toLowerCase()).not.toContain("waf");
  });
});
