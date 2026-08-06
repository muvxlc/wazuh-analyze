import { describe, expect, it } from "vitest";

import type { Role } from "./permissions";
import { resolvePermissions } from "./resolve";

describe("resolvePermissions", () => {
  it("applies deny before allow before role defaults", () => {
    const permissions = resolvePermissions({
      role: "admin",
      overrides: [
        { permission: "users.read", effect: "deny" },
        { permission: "alerts.resolve", effect: "allow" },
      ],
    });
    expect(permissions.has("users.read")).toBe(false);
    expect(permissions.has("alerts.resolve")).toBe(true);
  });

  it("super_admin receives all permissions", () => {
    const permissions = resolvePermissions({ role: "super_admin" });
    expect(permissions.has("dashboard.read")).toBe(true);
    expect(permissions.has("super_admins.manage")).toBe(true);
    expect(permissions.has("overrides.manage")).toBe(true);
    expect(permissions.has("settings.manage")).toBe(true);
    expect(permissions.has("audit.read")).toBe(true);
  });

  it("admin receives expected subset", () => {
    const permissions = resolvePermissions({ role: "admin" });
    expect(permissions.has("dashboard.read")).toBe(true);
    expect(permissions.has("alerts.read")).toBe(true);
    expect(permissions.has("alerts.list")).toBe(true);
    expect(permissions.has("alerts.details")).toBe(true);
    expect(permissions.has("alerts.acknowledge")).toBe(true);
    expect(permissions.has("alerts.resolve")).toBe(true);
    expect(permissions.has("agents.read")).toBe(true);
    expect(permissions.has("agents.list")).toBe(true);
    expect(permissions.has("users.read")).toBe(true);
    expect(permissions.has("users.manage")).toBe(true);
    expect(permissions.has("invites.manage")).toBe(true);
    expect(permissions.has("roles.read")).toBe(true);
    expect(permissions.has("sessions.revoke")).toBe(true);
    expect(permissions.has("audit.read")).toBe(true);
    expect(permissions.has("super_admins.manage")).toBe(false);
    expect(permissions.has("overrides.manage")).toBe(false);
    expect(permissions.has("settings.manage")).toBe(false);
  });

  it("user receives read-only subset", () => {
    const permissions = resolvePermissions({ role: "user" });
    expect(permissions.has("dashboard.read")).toBe(true);
    expect(permissions.has("alerts.read")).toBe(true);
    expect(permissions.has("alerts.list")).toBe(true);
    expect(permissions.has("alerts.details")).toBe(true);
    expect(permissions.has("agents.read")).toBe(true);
    expect(permissions.has("agents.list")).toBe(true);
    expect(permissions.has("alerts.resolve")).toBe(false);
    expect(permissions.has("users.manage")).toBe(false);
    expect(permissions.has("super_admins.manage")).toBe(false);
  });

  it("allow override adds permission not in role defaults", () => {
    const permissions = resolvePermissions({
      role: "user",
      overrides: [{ permission: "users.manage", effect: "allow" }],
    });
    expect(permissions.has("users.manage")).toBe(true);
  });

  it("deny override removes permission present in role defaults", () => {
    const permissions = resolvePermissions({
      role: "admin",
      overrides: [{ permission: "alerts.resolve", effect: "deny" }],
    });
    expect(permissions.has("alerts.resolve")).toBe(false);
  });

  it("deny wins over allow when same permission has both overrides", () => {
    const permissions = resolvePermissions({
      role: "admin",
      overrides: [
        { permission: "users.read", effect: "allow" },
        { permission: "users.read", effect: "deny" },
      ],
    });
    expect(permissions.has("users.read")).toBe(false);
  });

  it("empty overrides returns role defaults unchanged", () => {
    const permissions = resolvePermissions({ role: "user" });
    expect(permissions.has("dashboard.read")).toBe(true);
    expect(permissions.has("users.manage")).toBe(false);
  });

  it("rejects unknown role with error", () => {
    expect(() =>
      resolvePermissions({ role: "unknown_role" as unknown as Role }),
    ).toThrow();
  });
});
