"use client";

import { Copy } from "lucide-react";
import { useState } from "react";

export function InviteDialog({ onCreated }: { onCreated?: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <form
      className="panel invite-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setIsSubmitting(true);
        void fetch("/api/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: window.location.origin },
          body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
        })
          .then((response) => response.ok ? response.json() : null)
          .then((body) => {
            if (body?.data?.url) {
              setUrl(body.data.url);
              onCreated?.(body.data.url);
            }
          })
          .finally(() => setIsSubmitting(false));
      }}
    >
      <label className="form-field">Email <input suppressHydrationWarning name="email" type="email" required /></label>
      <label className="form-field">Role <select name="role"><option value="user">User</option><option value="admin">Admin</option></select></label>
      <button type="submit" disabled={isSubmitting}>Create invite</button>
      {url && <p className="invite-result" role="status">Copy invite URL: <input suppressHydrationWarning readOnly value={url} /><button type="button" className="outline-button" onClick={() => void navigator.clipboard.writeText(url)} aria-label="Copy invite URL" title="Copy invite URL"><Copy size={16} aria-hidden="true" /></button></p>}
    </form>
  );
}
