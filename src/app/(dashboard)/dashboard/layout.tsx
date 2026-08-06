"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS: Array<{ href: string; labelKey: "soc-tab-overview" | "soc-tab-soc" }> = [
  { href: "/dashboard", labelKey: "soc-tab-overview" },
  { href: "/dashboard/soc", labelKey: "soc-tab-soc" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("dashboard");

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">{t("overview-kicker")}</p>
          <h1 className="mb-0">{t("title")}</h1>
        </div>
        <nav className="flex gap-1 rounded-[var(--radius-panel)] border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-1" aria-label={t("soc-tab-group")}>
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-[calc(var(--radius-panel)-4px)] bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-on-dark)]"
                    : "rounded-[calc(var(--radius-panel)-4px)] px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-canvas-soft)]"
                }
              >
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </section>
  );
}
