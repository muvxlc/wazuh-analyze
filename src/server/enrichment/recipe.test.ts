import { describe, expect, it } from "vitest";
import { resolveRecipe } from "./recipe";

describe("resolveRecipe", () => {
  it("resolves auth/sshd groups to relatedAlerts + health + processes", () => {
    const keys = resolveRecipe(["authentication_failed", "syslog", "sshd"]);
    expect(keys).toEqual(["relatedAlerts", "health", "processes"]);
  });

  it("merges recipes for multi-domain alerts (rootcheck + fim)", () => {
    const keys = resolveRecipe(["rootcheck", "syscheck"]);
    expect(keys).toContain("rootcheck");
    expect(keys).toContain("processes");
    expect(keys).toContain("syscheck");
  });

  it("falls back to default recipe for unrecognized groups", () => {
    const keys = resolveRecipe(["unknown_group_123"]);
    expect(keys).toEqual(["relatedAlerts", "health"]);
  });

  it("handles case-insensitive and partial keywords", () => {
    const keys = resolveRecipe(["WEB_APP_ATTACK"]);
    expect(keys).toContain("threatIntel");
    expect(keys).toContain("relatedAlerts");
  });
});
