/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect } from "vitest";
import React from "react";
import { Popover } from "./popover";

afterEach(cleanup);

function renderPopover({ portal = false }: { portal?: boolean } = {}) {
  return render(
    <Popover
      ariaLabel="Test popover"
      portal={portal}
      trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} data-testid="trigger">
          {open ? "Open" : "Closed"}
        </button>
      )}
    >
      {() => (
        <div>
          <span data-testid="panel-content">Panel content</span>
          <button type="button" data-testid="inside-click">
            Inside
          </button>
        </div>
      )}
    </Popover>,
  );
}

describe("Popover", () => {
  it("opens and closes on trigger click (non-portal)", async () => {
    renderPopover();
    const user = userEvent.setup();

    expect(screen.queryByTestId("panel-content")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("panel-content")).toBeInTheDocument();
    await user.click(screen.getByTestId("trigger"));
    expect(screen.queryByTestId("panel-content")).not.toBeInTheDocument();
  });

  it("opens and closes on trigger click (portal)", async () => {
    renderPopover({ portal: true });
    const user = userEvent.setup();

    expect(screen.queryByTestId("panel-content")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("panel-content")).toBeInTheDocument();
    expect(screen.getByTestId("panel-content").closest("body")).toBe(document.body);
  });

  it("does not close when clicking inside the portal panel", async () => {
    renderPopover({ portal: true });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("panel-content")).toBeInTheDocument();
    await user.click(screen.getByTestId("inside-click"));
    expect(screen.getByTestId("panel-content")).toBeInTheDocument();
  });

  it("closes on outside click (portal)", async () => {
    render(
      <>
        <div data-testid="outside">Outside</div>
        <Popover
          ariaLabel="Test"
          portal
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} data-testid="trigger">
              Toggle
            </button>
          )}
        >
          {() => <span data-testid="panel-content">Panel</span>}
        </Popover>
      </>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("panel-content")).toBeInTheDocument();
    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByTestId("panel-content")).not.toBeInTheDocument();
  });

  it("closes on Escape (portal)", async () => {
    renderPopover({ portal: true });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("panel-content")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("panel-content")).not.toBeInTheDocument();
  });
});
