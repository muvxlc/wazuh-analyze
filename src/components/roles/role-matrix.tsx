"use client";

import { useEffect, useState } from "react";

interface RoleOverride {
  permission: string;
  effect: "allow" | "deny";
}

interface RoleData {
  role: string;
  defaults: string[];
  overrides: RoleOverride[];
  isEditable?: boolean;
}

interface RoleMatrixData {
  roles: RoleData[];
}

type CellState = "allowed" | "denied" | "inherited";

function resolveCellState(permission: string, role: RoleData): CellState {
  const isDefault = role.defaults.includes(permission);
  const override = role.overrides.find((o) => o.permission === permission);
  if (override) {
    return override.effect === "allow" ? "allowed" : "denied";
  }
  return isDefault ? "allowed" : "denied";
}

function getEffectiveState(permission: string, roles: RoleData[]): Record<string, CellState> {
  const state: Record<string, CellState> = {};
  for (const role of roles) {
    state[role.role] = resolveCellState(permission, role);
  }
  return state;
}

export function RoleMatrix() {
  const [data, setData] = useState<RoleMatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function fetchRoles() {
      try {
        const res = await fetch("/api/roles");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load roles");
      } finally {
        setLoading(false);
      }
    }
    fetchRoles();
  }, []);

  const handleToggle = async (role: string, permission: string, newEffect: "allow" | "deny") => {
    if (!data) return;
    setSaving(true);
    try {
      // Build the full overrides array for this role
      const existingOverrides = data.roles.find((r) => r.role === role)!.overrides;
      const updatedOverrides = existingOverrides
        .filter((o) => o.permission !== permission)
        .concat([{ permission, effect: newEffect }]);

      const res = await fetch(`/api/roles/${role}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: updatedOverrides }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Update local state optimistically
      setData({
        ...data,
        roles: data.roles.map((r) =>
          r.role === role ? { ...r, overrides: updatedOverrides } : r,
        ),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading roles...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!data) return null;

  const allPermissions = [...new Set(data.roles.flatMap((r) => [...r.defaults, ...r.overrides.map((o) => o.permission)]))].sort();
  const roleNames = ["super_admin", "admin", "user"] as const;

  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Role permissions</caption>
        <thead>
          <tr>
            <th>Permission</th>
            {roleNames.map((r) => (
              <th key={r}>{r.replace("_", " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allPermissions.map((permission) => {
            const states = getEffectiveState(permission, data.roles);
            return (
              <tr key={permission}>
                <td>{permission}</td>
                {roleNames.map((role) => {
                  const roleData = data.roles.find((r) => r.role === role)!;
                  const override = roleData.overrides.find((o) => o.permission === permission);
                  const currentState = override?.effect ?? (roleData.defaults.includes(permission) ? "allow" : "deny");
                  const editable = roleData.isEditable !== false;
                  return (
                    <td key={role} className={editable ? "" : "opacity-50"}>
                      <label className="sr-only" htmlFor={`${role}-${permission}`}>
                        {permission} for {role}
                      </label>
                      <select
                        id={`${role}-${permission}`}
                        aria-label={`${permission} for ${role}`}
                        value={currentState}
                        onChange={(e) => editable && handleToggle(role, permission, e.target.value as "allow" | "deny")}
                        disabled={saving || !editable}
                        className="role-select"
                      >
                        <option value="allow">Allowed</option>
                        <option value="deny">Denied</option>
                      </select>
                      <span className="state-label">{currentState === "allow" ? "Allowed" : "Denied"}</span>
                      {!editable && <span className="sr-only"> Read-only</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {saving && <div className="saving">Saving...</div>}
    </div>
  );
}
