"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface SourceEntry {
  id: string;
  sourceKey: string;
  sourceType: string;
  endpoint: string | null;
  credentialScope: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastEventAt: string | null;
  itemCount: number | null;
  parseErrorCount: number;
  freshnessSlaMs: number | null;
  contractVersion: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface Props {
  readonly source: SourceEntry;
  readonly canManage: boolean;
  readonly onSaved: (updated: SourceEntry) => void;
}

export function SlaEditor({ source, canManage, onSaved }: Props) {
  const t = useTranslations("sourceCoverage");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [slaError, setSlaError] = useState<string | null>(null);

  const startEdit = () => {
    setEditing(true);
    setDraft(source.freshnessSlaMs != null ? String(Math.round(source.freshnessSlaMs / 60000)) : "");
    setSlaError(null);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
    setSlaError(null);
  };

  const save = async () => {
    const mins = parseInt(draft, 10);
    if (isNaN(mins) || mins < 0 || mins > 1440) {
      setSlaError(t("sla-invalid"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/source-coverage/${encodeURIComponent(source.sourceKey)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ freshnessSlaMs: mins * 60000 }),
      });
      if (!res.ok) {
        setSlaError(t("sla-error"));
        return;
      }
      const updated = await res.json().then((r) => r.data as SourceEntry);
      onSaved(updated);
      setEditing(false);
      setDraft("");
      setSlaError(null);
    } catch (e) {
      setSlaError(e instanceof Error ? e.message : t("sla-error"));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={1440}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-16 border rounded px-1 py-0.5 text-xs"
          autoFocus
        />
        <span className="text-xs text-[var(--color-ink-muted)]">{t("sla-minutes")}</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="text-xs underline text-green-700 disabled:opacity-50"
        >
          {t("sla-save")}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="text-xs underline text-[var(--color-ink-muted)]"
        >
          {t("sla-cancel")}
        </button>
        {slaError && <p className="text-red-600 text-xs mt-0.5">{slaError}</p>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span>{source.freshnessSlaMs != null ? `${Math.round(source.freshnessSlaMs / 60000)}m` : "—"}</span>
      {canManage && (
        <button
          type="button"
          onClick={startEdit}
          className="text-[var(--color-ink-muted)] hover:text-ink"
          title={t("sla-edit")}
          aria-label={t("sla-edit")}
        >
          ✏️
        </button>
      )}
    </span>
  );
}
