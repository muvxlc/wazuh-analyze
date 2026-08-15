"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { RawJson } from "./raw-json";
import { AlertAnalysisPanel } from "./alert-analysis-panel";
import { AlertEvidencePanel } from "./alert-evidence-panel";
import { SEVERITY_COLORS, severityFromLevel, severityLabel } from "../../server/alerts/severity-mapper";
import type { AlertDetail as AlertDetailType } from "../../server/alerts/types";

interface AlertDrawerProps {
  alert: AlertDetailType | null;
  isOpen: boolean;
  onClose: () => void;
  canAnalyze?: boolean;
}

export function AlertDrawer({ alert, isOpen, onClose, canAnalyze = false }: AlertDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && drawerRef.current) {
        const focusable = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !alert) return null;

  const severity = severityFromLevel(alert.level);
  const severityColor = SEVERITY_COLORS[severity];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Alert detail"
      ref={drawerRef}
      className="fixed inset-0 z-50 flex bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="alert-drawer-panel w-full bg-[var(--color-canvas)] p-4 shadow-[var(--shadow-modal)] md:max-w-4xl md:h-auto md:max-h-[90vh] md:rounded-[8px] md:m-auto flex flex-col h-full">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--color-hairline)] pb-2 flex-none">
          <h2 className="m-0 text-base font-medium">{alert.ruleDescription}</h2>
          <div className="flex items-center gap-2">
            <Link href={`/alerts/${alert.id}`} className="outline-button px-2 py-1 text-[13px]">
              Full detail
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="outline-button px-2 py-1 text-[13px]"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pr-2">
          <AlertAnalysisPanel alertId={alert.id} canAnalyze={canAnalyze} />
          <AlertEvidencePanel alertId={alert.id} />
          <dl className="detail-list">
            <div><dt>Agent</dt><dd>{alert.agentName ?? alert.agentId ?? "-"}</dd></div>
            <div><dt>Rule ID</dt><dd>{alert.ruleId ?? "-"}</dd></div>
            <div><dt>Severity</dt><dd>
              <span
                className="severity-badge"
                style={{ backgroundColor: severityColor, color: "var(--color-on-dark)", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}
              >
                {severityLabel(severity)} (level {alert.level})
              </span>
            </dd></div>
            <div><dt>Status</dt><dd>{alert.status}</dd></div>
            <div><dt>Groups</dt><dd>{alert.groups.join(", ") || "-"}</dd></div>
            <div><dt>Tags</dt><dd>
              {alert.tags.length === 0
                ? <span className="muted">-</span>
                : alert.tags.map((tag) => <span key={tag} className="group-badge">{tag}</span>)}
            </dd></div>
            <div><dt>Received</dt><dd>{formatDate(alert.ingestedAt)}</dd></div>
          </dl>
          {alert.timeline.length > 0 && (
            <section className="panel detail-section mt-4" style={{ padding: "var(--space-lg)" }}>
              <h3 className="m-0 mb-2 text-sm font-medium">Timeline</h3>
              <ol style={{ margin: 0, paddingLeft: "var(--space-xl)" }}>
                {alert.timeline.map((event) => (
                  <li key={event.id}>{event.toStatus} · {formatDate(event.occurredAt)}</li>
                ))}
              </ol>
            </section>
          )}
          <section className="panel mt-4" style={{ padding: "var(--space-lg)" }}>
            <h3 className="m-0 mb-2 text-sm font-medium">Raw payload</h3>
            <RawJson value={alert.rawPayload} />
          </section>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: Date | string | null | undefined): string {
  if (value == null) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return date.toISOString();
}
