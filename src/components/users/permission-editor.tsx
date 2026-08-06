"use client";

import { PERMISSIONS } from "../../server/authorization/permissions";

type Override = { permission: string; effect: "allow" | "deny" };

export function PermissionEditor({
  defaults = [],
  overrides = [],
  onChange,
}: {
  defaults?: readonly string[];
  overrides?: readonly Override[];
  onChange?: (overrides: Override[]) => void;
}) {
  const all = [...new Set([...Object.values(PERMISSIONS), ...defaults, ...overrides.map((item) => item.permission)])];
  const setOverride = (permission: string, effect: Override["effect"] | "inherit") => {
    const next = overrides.filter((item) => item.permission !== permission);
    if (effect !== "inherit") next.push({ permission, effect });
    onChange?.(next);
  };
  return <fieldset>
    <legend>Permission overrides</legend>
    <div style={{ overflowX: "auto" }}><table><thead><tr><th>Permission</th><th>State</th></tr></thead><tbody>
      {all.map((permission) => {
        const override = overrides.find((item) => item.permission === permission);
        const state = override ? (override.effect === "allow" ? "Allowed" : "Denied") : "Inherited";
        return <tr key={permission}><td>{permission}</td><td>
          <select aria-label={`${permission} state`} value={override?.effect ?? "inherit"} onChange={(event) => setOverride(permission, event.target.value as Override["effect"] | "inherit")}>
            <option value="inherit">Inherited</option><option value="allow">Allowed</option><option value="deny">Denied</option>
          </select> <span>{state}</span>
        </td></tr>;
      })}
    </tbody></table></div>
  </fieldset>;
}
