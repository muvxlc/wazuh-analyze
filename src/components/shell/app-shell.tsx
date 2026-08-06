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
    <div className="app-shell min-h-screen bg-[var(--color-canvas-soft)]">
      <TopBar user={user} onOpenMenu={() => setDrawerOpen(true)} />
      <div className="flex min-h-[calc(100vh-64px)]">
        <aside className="hidden w-[248px] flex-shrink-0 border-r border-[var(--color-hairline)] bg-[var(--color-canvas)] px-4 py-6 md:block">
          <Sidebar permissions={user.permissions} />
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="page-section">{children}</div>
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
