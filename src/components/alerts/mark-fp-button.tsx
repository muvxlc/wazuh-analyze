"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

// Client island: marks an alert's (ruleId, agentId, level) as a known FP
// signature by POSTing /api/alerts/[id]/fp-signature. Server enforces the
// alerts.manage_fp permission and returns 403 otherwise — we self-hide so
// operators without the permission see no broken control. No CSRF header is
// set here: the route calls assertCsrfSafe (Origin check), mirroring every
// other client fetch in this app (alert-analysis-panel, soc settings).
interface MarkFpButtonProps {
  alertId: string;
}

type Status = "idle" | "submitting" | "done" | "forbidden" | "error";

export function MarkFpButton({ alertId }: MarkFpButtonProps) {
  const t = useTranslations("settings");
  const [status, setStatus] = useState<Status>("idle");
  const [armed, setArmed] = useState(false);
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 403 => operator lacks alerts.manage_fp: hide the control entirely.
  if (status === "forbidden") return null;

  // Success: show a compact FP-suppressed badge, nothing else to do.
  if (status === "done") {
    return (
      <span className="group-badge" role="status">
        {t("fp-suppressed-badge")}
      </span>
    );
  }

  async function armOrSubmit() {
    // First click arms (reveals the optional reason input); second click submits.
    if (!armed) {
      setArmed(true);
      return;
    }
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const trimmed = reason.trim();
      // Reason is optional server-side (zod min(1) when present) — omit when blank.
      const body = trimmed ? JSON.stringify({ reason: trimmed }) : JSON.stringify({});
      const res = await fetch(`/api/alerts/${alertId}/fp-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.status === 403) {
        setStatus("forbidden");
        return;
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
        throw new Error(payload?.error?.code ?? `Request failed (${res.status})`);
      }
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.25rem", alignItems: "center" }}>
      <button
        type="button"
        className="outline-button"
        disabled={status === "submitting"}
        onClick={() => void armOrSubmit()}
      >
        {status === "submitting" ? "…" : t("mark-as-fp")}
      </button>
      {armed && status !== "submitting" && (
        <input
          type="text"
          className="auth-input"
          placeholder={t("fp-signature-reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          aria-label={t("fp-signature-reason")}
        />
      )}
      {errorMsg && (
        <span role="alert" style={{ color: "var(--color-danger)", fontSize: "0.8rem" }}>
          {errorMsg}
        </span>
      )}
    </span>
  );
}
