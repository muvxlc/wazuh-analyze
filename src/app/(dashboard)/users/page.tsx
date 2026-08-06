"use client";
import { useEffect, useState } from "react";
import { UserTable } from "../../../components/users/user-table";
import { InviteDialog } from "../../../components/users/invite-dialog";
export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const refresh = () => { void fetch("/api/users").then((r) => r.json()).then((b) => { if (b.data?.users) setUsers(b.data.users); }); };
  useEffect(() => refresh(), []);
  return <section><h1>Users</h1><InviteDialog /> <UserTable users={users} onRefresh={refresh} /></section>;
}
