"use client";

import type { UserSummary } from "../../server/users/user-service";

export function UserTable({ users, onRefresh }: { users: Array<UserSummary & { createdAt?: Date | string }>; onRefresh?: () => void }) {
  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Users</caption>
        <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.email}</td><td>{user.displayName}</td><td>{user.role}</td>
              <td>{user.isActive ? "Active" : "Inactive"}</td>
              <td className="table-actions">
                <button type="button" onClick={() => { void fetch(`/api/users/${user.id}/activation`, { method: "POST", headers: { "Content-Type": "application/json", origin: window.location.origin }, body: JSON.stringify({ isActive: !user.isActive }) }).then(onRefresh); }}>{user.isActive ? "Deactivate" : "Activate"}</button>
                <button className="outline-button" type="button" onClick={() => { void fetch(`/api/users/${user.id}/sessions/revoke`, { method: "POST", headers: { origin: window.location.origin } }).then(onRefresh); }}>Revoke sessions</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
