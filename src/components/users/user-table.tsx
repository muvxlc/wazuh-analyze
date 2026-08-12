"use client";

import { useState } from "react";
import type { UserSummary } from "../../server/users/user-service";

type UserRow = UserSummary & { createdAt?: Date | string };
type UserAction = "activate" | "deactivate" | "revoke";

interface UserTableProps {
  users: UserRow[];
  loading?: boolean;
  onRefresh?: () => void;
}

export function UserTable({ users, loading = false, onRefresh }: UserTableProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAction(user: UserRow, action: UserAction): Promise<void> {
    if (action === "deactivate" && !window.confirm(`Deactivate ${user.email}?`)) return;
    if (action === "revoke" && !window.confirm(`Revoke all sessions for ${user.email}?`)) return;

    const actionKey = `${action}:${user.id}`;
    setPendingAction(actionKey);
    setActionError(null);
    try {
      const response = await fetch(
        action === "revoke" ? `/api/users/${user.id}/sessions/revoke` : `/api/users/${user.id}/activation`,
        action === "revoke"
          ? { method: "POST", headers: { origin: window.location.origin } }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json", origin: window.location.origin },
              body: JSON.stringify({ isActive: action === "activate" }),
            },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await onRefresh?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "User action failed");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="table-scroll">
      {actionError && <p className="status-error mb-4 p-3 text-sm" role="alert">{actionError}</p>}
      <table>
        <caption className="sr-only">Users</caption>
        <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} role="status" className="text-center">Loading users...</td></tr>
          ) : users.length === 0 ? (
            <tr><td colSpan={5} role="status" className="text-center">No users found.</td></tr>
          ) : users.map((user) => {
            const actionKey = `:${user.id}`;
            return (
              <tr key={user.id}>
                <td className="break-all">{user.email}</td><td>{user.displayName}</td><td>{user.role}</td>
                <td>{user.isActive ? "Active" : "Inactive"}</td>
                <td className="table-actions" role="group" aria-label={`${user.email} actions`}>
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => { void handleAction(user, user.isActive ? "deactivate" : "activate"); }}
                  >{user.isActive ? "Deactivate" : "Activate"}</button>
                  <button
                    className="outline-button"
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => { void handleAction(user, "revoke"); }}
                  >Revoke sessions</button>
                  {pendingAction?.endsWith(actionKey) && <span className="sr-only" role="status">Updating {user.email}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
