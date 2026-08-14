"use client";

import { useEffect, useRef, useState } from "react";

// Generic 5s countdown toast with an Undo + Dismiss action. Lifted from alerts for reuse.
export function UndoToast({
  message,
  undoLabel = "Undo",
  dismissLabel = "Dismiss",
  onUndo,
  onClose,
}: {
  readonly message: string;
  readonly undoLabel?: string;
  readonly dismissLabel?: string;
  readonly onUndo: () => void;
  readonly onClose: () => void;
}) {
  const [progress, setProgress] = useState(100);
  const startedAt = useRef<number | null>(null);
  const DURATION = 5000;

  useEffect(() => {
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - (startedAt.current ?? Date.now());
      const remaining = Math.max(0, 100 - (elapsed / DURATION) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onClose();
      }
    }, 50);
    return () => clearInterval(timer);
  }, [onClose]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="status-error"
      style={{ position: "fixed", bottom: "var(--space-lg)", right: "var(--space-lg)", zIndex: 100, maxWidth: "320px" }}
    >
      <p style={{ margin: "0 0 var(--space-sm) 0" }}>{message}</p>
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button type="button" onClick={onUndo}>
          {undoLabel}
        </button>
        <button type="button" onClick={onClose} className="outline-button">
          {dismissLabel}
        </button>
      </div>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: "2px",
          width: `${progress}%`,
          backgroundColor: "var(--color-danger)",
          transition: "width 50ms linear",
        }}
      />
    </div>
  );
}
