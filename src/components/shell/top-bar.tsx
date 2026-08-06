"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
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
    <header className="flex h-[64px] items-center justify-between border-b border-[var(--color-hairline)] px-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={tShell("menu")}
          onClick={onOpenMenu}
          className="rounded-[6px] border border-[var(--color-hairline)] px-2 py-1 text-[14px] md:hidden"
        >
          {tShell("menu")}
        </button>
        <span className="text-[18px] font-medium">Wazuh</span>
      </div>
      <div className="flex items-center gap-4">
        <LocaleSwitcher currentLocale={user.locale} />
        <span className="text-[14px] text-[var(--color-ink-muted)]">{user.displayName}</span>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-[6px] bg-[var(--color-canvas-soft)] px-[12px] py-[6px] text-[13px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-hairline)]"
        >
          {t("logout")}
        </button>
      </div>
    </header>
  );
}
