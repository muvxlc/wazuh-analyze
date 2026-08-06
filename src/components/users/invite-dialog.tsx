"use client";
import { useState } from "react";
export function InviteDialog({ onCreated }: { onCreated?: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void fetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json", origin: window.location.origin }, body: JSON.stringify({ email: form.get("email"), role: form.get("role") }) }).then((response) => response.json()).then((body) => { if (body.data?.url) { setUrl(body.data.url); onCreated?.(body.data.url); } }); }}><label>Email <input name="email" type="email" required /></label> <label>Role <select name="role"><option value="user">User</option><option value="admin">Admin</option></select></label> <button type="submit">Create invite</button>{url && <p role="status">Copy invite URL: <input readOnly value={url} /></p>}</form>;
}
