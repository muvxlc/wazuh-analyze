/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { ChecklistPopover } from "./checklist-popover";

afterEach(cleanup);

const options = [
  { value: "core", label: "Core Servers" },
  { value: "dmz", label: "DMZ" },
  { value: "web", label: "Web" },
];

function makeProps(overrides: Partial<React.ComponentProps<typeof ChecklistPopover>> = {}) {
  return {
    trigger: ({ open, toggle, selectedCount }: { open: boolean; toggle: () => void; selectedCount: number }) => (
      <button
        type="button"
        className="outline-button"
        onClick={toggle}
        data-testid="checklist-trigger"
        aria-expanded={open}
      >
        Filters ({selectedCount})
      </button>
    ),
    options,
    selected: [],
    onApply: vi.fn(),
    onClear: vi.fn(),
    ariaLabel: "Filter options",
    ...overrides,
  };
}

describe("ChecklistPopover", () => {
  it("renders trigger with selected count", () => {
    const props = makeProps({ selected: ["core"] });
    render(<ChecklistPopover {...props} />);
    expect(screen.getByTestId("checklist-trigger")).toHaveTextContent("Filters (1)");
  });

  it("opens panel on trigger click", async () => {
    const props = makeProps();
    render(<ChecklistPopover {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checklist-trigger"));
    expect(screen.getByTestId("checklist-search")).toBeInTheDocument();
  });

  it("shows selected chips in draft", async () => {
    const props = makeProps({ selected: ["core", "dmz"] });
    render(<ChecklistPopover {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checklist-trigger"));
    const boxes = screen.getAllByRole("checkbox");
    // core and dmz should be checked
    expect(boxes[0]).toBeChecked(); // core
    expect(boxes[1]).toBeChecked(); // dmz
    expect(boxes[2]).not.toBeChecked(); // web
  });

  it("filters options by search", async () => {
    const props = makeProps();
    render(<ChecklistPopover {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checklist-trigger"));
    await user.type(screen.getByTestId("checklist-search"), "dm");
    expect(screen.getByText("DMZ")).toBeInTheDocument();
    expect(screen.queryByText("Core Servers")).not.toBeInTheDocument();
  });

  it("applies selected on Apply click", async () => {
    const onApply = vi.fn();
    const props = makeProps({ onApply });
    render(<ChecklistPopover {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checklist-trigger"));
    await user.click(screen.getByRole("checkbox", { name: /core/i }));
    await user.click(screen.getByRole("checkbox", { name: /web/i }));
    await user.click(screen.getByTestId("checklist-apply"));
    expect(onApply).toHaveBeenCalledWith(["core", "web"]);
  });

  it("clears draft and calls onClear", async () => {
    const onClear = vi.fn();
    const props = makeProps({ selected: ["core"], onClear });
    render(<ChecklistPopover {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checklist-trigger"));
    await user.click(screen.getByTestId("checklist-clear"));
    expect(onClear).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const props = makeProps();
    render(<ChecklistPopover {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checklist-trigger"));
    expect(screen.getByTestId("checklist-search")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("checklist-search")).not.toBeInTheDocument();
  });

  it("closes on outside click", async () => {
    const props = makeProps();
    const { container } = render(
      <>
        <div id="outside">click me</div>
        <ChecklistPopover {...props} />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checklist-trigger"));
    expect(screen.getByTestId("checklist-search")).toBeInTheDocument();
    await user.click(screen.getByText("click me"));
    expect(screen.queryByTestId("checklist-search")).not.toBeInTheDocument();
  });

  it("shows no results when search has no match", async () => {
    const props = makeProps();
    render(<ChecklistPopover {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checklist-trigger"));
    await user.type(screen.getByTestId("checklist-search"), "zzz-nonexistent");
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
