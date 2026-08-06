"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { LocaleSwitcher } from "../locale-switcher";
import type { AuthenticatedUser } from "../../server/auth/authenticate";

interface TopBarProps {
  user: AuthenticatedUser;
  onOpenMenu: () => void;
}

export function TopBar({ user, onOpenMenu }: TopBarProps) {
  const t = useTranslations("auth");
  const tShell = useTranslations("shell");
  const router = useRouter();

  const handleLogout = async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) {
      alert("Failed to logout");
      return;
    }
    router.push("/login");
  };

  return (
    <header className="top-bar sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--color-hairline)] bg-[var(--color-canvas)] px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={tShell("menu")}
          title={tShell("menu")}
          onClick={onOpenMenu}
          className="outline-button inline-flex h-10 w-10 items-center justify-center p-0 md:hidden"
        >
          <Menu aria-hidden="true" size={20} />
        </button>
        <span className="text-lg font-semibold tracking-tight">Wazuh</span>
      </div>
      <div className="flex items-center gap-3 sm:gap-5">
        <LocaleSwitcher currentLocale={user.locale} />
        <span className="hidden text-sm text-[var(--color-ink-muted)] sm:inline">{user.displayName}</span>
        <button
          type="button"
          onClick={handleLogout}
          title={t("logout")}
          className="outline-button inline-flex h-10 items-center gap-2 px-3 text-sm"
        >
          <LogOut aria-hidden="true" size={16} />
          <span className="hidden sm:inline">{t("logout")}</span>
        </button>
      </div>
    </header>
  );
}
