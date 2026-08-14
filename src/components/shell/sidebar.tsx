"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Bell, Bot, LayoutDashboard, Layers, Network, Settings, ShieldAlert, ShieldCheck, Users, SearchCode } from "lucide-react";
import { usePathname } from "next/navigation";
import { PERMISSIONS, type Permission } from "../../server/authorization/permissions";

interface SidebarProps {
  permissions: ReadonlySet<Permission> | Set<string>;
}

interface NavItem {
  key: string;
  href: string;
  permission?: string;
  icon: typeof LayoutDashboard;
}

interface SettingsSubItem {
  key: string;
  href: string;
  label: string;
}

const workspaceItems: NavItem[] = [
  { key: "dashboard", href: "/dashboard", permission: PERMISSIONS.dashboardRead, icon: LayoutDashboard },
  { key: "alerts", href: "/alerts", permission: PERMISSIONS.alertsRead, icon: Bell },
  { key: "threatIntel", href: "/threat-intel", permission: PERMISSIONS.tiRead, icon: SearchCode },
  { key: "agents", href: "/agents", permission: PERMISSIONS.agentsRead, icon: Network },
  { key: "vulnerabilities", href: "/vulnerabilities", permission: PERMISSIONS.vulnerabilitiesRead, icon: ShieldAlert },
  { key: "posture", href: "/posture", permission: PERMISSIONS.postureRead, icon: ShieldCheck },
  { key: "hygiene", href: "/hygiene", permission: PERMISSIONS.postureRead, icon: ShieldCheck },
  { key: "incidents", href: "/incidents", permission: PERMISSIONS.incidentsRead, icon: ShieldAlert },
  { key: "mitre", href: "/mitre", permission: PERMISSIONS.mitreRead, icon: ShieldAlert },
  { key: "compliance", href: "/compliance", permission: PERMISSIONS.complianceRead, icon: ShieldCheck },
  { key: "chat", href: "/chat", permission: PERMISSIONS.chatUse, icon: Bot },
];

const adminItems: NavItem[] = [
  { key: "users", href: "/users", permission: PERMISSIONS.usersRead, icon: Users },
  { key: "roles", href: "/roles", permission: PERMISSIONS.rolesRead, icon: ShieldCheck },
  { key: "queues", href: "/queues", permission: PERMISSIONS.queuesRead, icon: Layers },
  { key: "sourceCoverage", href: "/source-coverage", permission: PERMISSIONS.settingsManage, icon: Layers },
];

const settingsSubItems: SettingsSubItem[] = [
  { key: "settings-local", href: "/settings/local", label: "settings-local" },
  { key: "settings-cloud", href: "/settings/cloud", label: "settings-cloud" },
  { key: "settings-ai", href: "/settings/ai", label: "settings-ai" },
  { key: "settings-soc", href: "/settings/soc", label: "settings-soc" },
  { key: "settings-notifications", href: "/settings/notifications", label: "settings-notifications" },
];

export function Sidebar({ permissions }: SidebarProps) {
  const t = useTranslations("shell");
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      <p className="mb-3 px-3 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Workspace</p>
      {workspaceItems.map((item) => {
        if (item.permission && !permissions.has(item.permission)) return null;
        const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-10 items-center gap-3 rounded-[6px] px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                : "text-[var(--color-ink-muted)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
            }`}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{t(item.key as any)}</span>
          </Link>
        );
      })}
      {(permissions.has(PERMISSIONS.usersRead) || permissions.has(PERMISSIONS.rolesRead) || permissions.has(PERMISSIONS.queuesRead) || permissions.has(PERMISSIONS.settingsManage)) && (
        <>
          <div className="my-2 border-t border-[var(--color-hairline)]" />
          <p className="mb-2 px-3 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Admin</p>
          {adminItems.map((item) => {
            if (item.permission && !permissions.has(item.permission)) return null;
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-10 items-center gap-3 rounded-[6px] px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
                }`}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{t(item.key as any)}</span>
              </Link>
            );
          })}
          {permissions.has(PERMISSIONS.settingsManage) && settingsSubItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-10 items-center gap-3 rounded-[6px] px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-canvas-soft)] hover:text-[var(--color-ink)]"
                }`}
              >
                <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{t(item.label as any)}</span>
              </Link>
            );
          })}
        </>
      )}
    </nav>
  );
}
