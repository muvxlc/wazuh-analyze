"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileDrawer } from "./mobile-drawer";
import type { AuthenticatedUser } from "../../server/auth/authenticate";

export interface AppShellProps {
  user: AuthenticatedUser;
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-canvas)]">
      <TopBar user={user} onOpenMenu={() => setDrawerOpen(true)} />
      <div className="flex flex-1">
        <aside className="hidden w-[240px] flex-shrink-0 border-r border-[var(--color-hairline)] p-4 md:block">
          <Sidebar permissions={user.permissions} />
        </aside>
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
      <MobileDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        permissions={user.permissions}
      />
    </div>
  );
}
