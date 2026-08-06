/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { MobileDrawer } from "./mobile-drawer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

function DrawerWrapper() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>menu</button>
      <MobileDrawer isOpen={open} onClose={() => setOpen(false)} permissions={new Set(["dashboard.read"])} />
    </div>
  );
}

describe("MobileDrawer accessibility", () => {
  it("closes drawer on Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<DrawerWrapper />);
    
    const menuBtn = screen.getByRole("button", { name: /menu/i });
    await user.click(menuBtn);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const closeBtn = screen.getByRole("button", { name: "close" });
    const links = screen.getAllByRole("link");
    expect(closeBtn).toHaveFocus();
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(closeBtn).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(menuBtn).toHaveFocus();
  });
});
