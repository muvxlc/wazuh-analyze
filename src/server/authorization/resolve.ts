import type { Role, OverrideEffect } from "./permissions";
import { ROLE_DEFAULTS } from "./role-defaults";

export interface PermissionOverride {
  permission: string;
  effect: OverrideEffect;
}

export interface ResolvePermissionsInput {
  role: Role;
  overrides?: PermissionOverride[];
}

export function resolvePermissions(input: ResolvePermissionsInput): Set<string> {
  const { role, overrides = [] } = input;
  const defaults = ROLE_DEFAULTS[role];
  if (defaults === undefined) {
    throw new Error(`Unknown role: ${role}`);
  }
  const result = new Set<string>(defaults);

  // Track explicit overrides: deny wins if present for same permission.
  const denySet = new Set<string>();
  const allowSet = new Set<string>();
  for (const override of overrides) {
    if (override.effect === "deny") {
      denySet.add(override.permission);
    } else {
      allowSet.add(override.permission);
    }
  }

  // Apply: deny removes, allow adds, but deny takes precedence.
  for (const perm of denySet) {
    result.delete(perm);
  }
  for (const perm of allowSet) {
    if (!denySet.has(perm)) {
      result.add(perm);
    }
  }

  return result;
}
