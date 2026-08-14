"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function IncidentNotes({ incidentId, canManage }: { incidentId: string, canManage: boolean }) {
  const t = useTranslations("incidents");
  const [notes, setNotes] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/incidents/${incidentId}/notes`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.data)) setNotes(data.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [incidentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || submitting || !canManage) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setNotes([...notes, data]);
        setBody("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-[8px] border border-[var(--color-hairline)] p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {t("analystNotes")}
      </h2>

      <div className="flex flex-col gap-3 mb-6">
        {loading ? (
          <div className="text-xs text-[var(--color-ink-muted)]">{t("loadingNotes")}</div>
        ) : notes.length === 0 ? (
          <div className="text-xs text-[var(--color-ink-muted)]">{t("noNotes")}</div>
        ) : (
          notes.map(note => (
            <div key={note.id} className="rounded bg-[var(--color-canvas-subtle)] p-3 border border-[var(--color-hairline)]">
              <p className="text-sm text-[var(--color-ink)] whitespace-pre-wrap">{note.body}</p>
              <div className="text-xs text-[var(--color-ink-muted)] mt-2">
                {new Date(note.createdAt).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>

      {canManage && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("notePlaceholder")}
            className="w-full rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-canvas)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] min-h-[80px]"
            disabled={submitting}
          />
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="self-end rounded-[6px] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {t("addNote")}
          </button>
        </form>
      )}
    </section>
  );
}
