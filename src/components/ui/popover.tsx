"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Minimal accessible popover.
 *
 * Owns open state, Escape-to-close, and outside-click-to-close. Does not own
 * focus trapping beyond auto-focusing the panel; callers pass a labelled panel
 * and any inputs inside receive natural tab order.
 *
 * When `portal` is true the panel renders via `createPortal` into `document.body`
 * so it escapes any `overflow: hidden/auto` ancestors (e.g. the table-scroll
 * container that wraps agent-table).
 */
export function Popover({
  trigger,
  children,
  ariaLabel,
  align = "start",
  disabled = false,
  onOpenChange,
  portal = false,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  ariaLabel: string;
  align?: "start" | "end";
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render the panel via createPortal to body to escape overflow clipping. */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => !prev);
  }, [disabled]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // Close on outside pointer down.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (root && !root.contains(event.target as Node) && (!panel || !panel.contains(event.target as Node))) close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, close]);

  // Escape closes; focus panel when it opens.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Position portal panel relative to trigger and keep it inside viewport.
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !portal || !rootRef.current || !panelRef.current) return;

    const reposition = () => {
      const triggerRect = rootRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!triggerRect || !panel) return;

      const gap = 8;
      const inset = 12;
      const panelWidth = Math.min(panel.offsetWidth || 320, window.innerWidth - inset * 2);
      const panelHeight = panel.offsetHeight;
      const below = window.innerHeight - triggerRect.bottom - gap - inset;
      const above = triggerRect.top - gap - inset;
      const showAbove = below < panelHeight && above > below;
      const top = showAbove
        ? Math.max(inset, triggerRect.top - gap - panelHeight)
        : Math.min(triggerRect.bottom + gap, window.innerHeight - inset - panelHeight);
      const preferredLeft = align === "end"
        ? triggerRect.right - panelWidth
        : triggerRect.left;
      const left = Math.max(inset, Math.min(preferredLeft, window.innerWidth - inset - panelWidth));

      setPortalStyle({
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: `${panelWidth}px`,
        maxHeight: `${Math.max(160, window.innerHeight - inset * 2)}px`,
        overflowY: "auto",
      });
    };

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, portal, align]);

  const panel = (
    <div
      ref={panelRef}
      className={`popover-panel popover-align-${align}${portal ? " popover-panel--portal" : ""}`}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={portal ? { ...portalStyle } : undefined}
    >
      {children({ close })}
    </div>
  );

  return (
    <div className="popover" ref={rootRef} data-open={open}>
      {trigger({ open, toggle })}
      {open && (portal ? createPortal(panel, document.body) : panel)}
    </div>
  );
}
