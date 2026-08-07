"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface ActionDetail {
  id: string;
  status: "proposed" | "approved" | "executed" | "rejected";
  command: string;
  reason: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function IncidentActions({ incidentId, canApprove }: { incidentId: string, canApprove: boolean }) {
  const t = useTranslations("incidents");
  const [actions, setActions] = useState<ActionDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/incidents/${incidentId}/actions`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.data)) {
          setActions(data.data as ActionDetail[]);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [incidentId]);

  const handleDecision = async (actionId: string, decision: "approve" | "reject") => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}/actions/${actionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (res.ok) {
        setActions(prev => prev.map(a => a.id === actionId ? { ...a, status: decision === "approve" ? "approved" : "rejected" } : a));
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading || actions.length === 0) return null;

  return (
    <section className="rounded-[8px] border border-[var(--color-hairline)] p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        Proposed Actions
      </h2>
      <div className="flex flex-col gap-4">
        {actions.map(action => (
          <div key={action.id} className="rounded-[6px] bg-[var(--color-canvas-soft)] p-4 text-sm border border-[var(--color-hairline)]">
            <div className="flex justify-between items-start mb-2">
              <span className="font-mono font-bold text-[var(--color-primary)]">{action.command}</span>
              <span className={`text-xs uppercase font-semibold px-2 py-0.5 rounded ${
                action.status === 'executed' ? 'bg-green-100 text-green-800' :
                action.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                action.status === 'rejected' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>{action.status}</span>
            </div>
            <p className="text-[var(--color-ink-muted)] mb-3">{action.reason}</p>
            {action.status === "proposed" && canApprove && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleDecision(action.id, "approve")}
                  className="rounded-[4px] bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void handleDecision(action.id, "reject")}
                  className="rounded-[4px] border border-[var(--color-hairline)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-ink)] hover:bg-gray-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
