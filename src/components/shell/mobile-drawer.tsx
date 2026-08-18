"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Sidebar } from "./sidebar";
import type { Permission } from "../../server/authorization/permissions";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  permissions: ReadonlySet<Permission> | Set<string>;
}

export function MobileDrawer({ isOpen, onClose, permissions }: MobileDrawerProps) {
  const t = useTranslations("shell");
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

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Main navigation"
      ref={drawerRef}
      className="fixed inset-0 z-50 flex bg-black/50 md:hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-[280px] flex-col overflow-y-auto bg-[var(--color-canvas)] p-4 shadow-[var(--shadow-modal)]">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--color-hairline)] pb-2">
          <span className="font-medium">Wazuh</span>
          <button
            type="button"
            onClick={onClose}
            className="outline-button px-2 py-1 text-[13px]"
          >
            {t("close")}
          </button>
        </div>
        <Sidebar permissions={permissions} />
      </div>
    </div>
  );
}
