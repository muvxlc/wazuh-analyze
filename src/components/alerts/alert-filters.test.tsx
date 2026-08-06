/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { AlertFilters } from "./alert-filters";

afterEach(cleanup);

function StatefulFilters({
  initial = [] as string[],
  groupOptions,
  onChange,
}: {
  initial?: string[];
  groupOptions: readonly string[];
  onChange: (filters: { search?: string; status?: string; levelMin?: string; groups?: string }) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <AlertFilters
      groupOptions={groupOptions}
      selectedGroups={selected}
      onGroupsChange={setSelected}
      onChange={onChange}
    />
  );
}

describe("AlertFilters", () => {
  const onChange = vi.fn();
  const onToggleHideLow = vi.fn();

  const defaultProps = {
    onChange,
    hideLow: false,
    onToggleHideLow,
    groupOptions: ["core-servers", "dmz", "web"] as const,
  };

  it("renders search, status select, and groups trigger", () => {
    render(<AlertFilters {...defaultProps} />);
    expect(screen.getByLabelText(/search/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /groups/i })).toBeInTheDocument();
  });

  it("opens popover, selects groups, applies, and passes selection to onGroupsChange", async () => {
    onChange.mockClear();
    const onGroupsChange = vi.fn();
    render(<AlertFilters {...defaultProps} onGroupsChange={onGroupsChange} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /groups/i }));
    await user.click(screen.getByRole("checkbox", { name: /core-servers/i }));
    await user.click(screen.getByRole("checkbox", { name: /dmz/i }));
    await user.click(screen.getByRole("button", { name: /apply/i }));

    expect(onGroupsChange).toHaveBeenCalledWith(["core-servers", "dmz"]);
  });

  it("clears all groups via Clear button", async () => {
    onChange.mockClear();
    const onGroupsChange = vi.fn();
    render(
      <AlertFilters
        {...defaultProps}
        selectedGroups={["core-servers"]}
        onGroupsChange={onGroupsChange}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /groups/i }));
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(onGroupsChange).toHaveBeenCalledWith([]);
  });

  it("handles hide-low toggle", async () => {
    onToggleHideLow.mockClear();
    render(<AlertFilters {...defaultProps} hideLow={false} />);
    const user = userEvent.setup();

    const checkbox = screen.getByRole("checkbox", { name: /hide low/i });
    await user.click(checkbox);
    expect(onToggleHideLow).toHaveBeenCalledWith(true);
  });

  it("renders selected groups as removable chips", async () => {
    onChange.mockClear();
    const onGroupsChange = vi.fn();
    render(
      <AlertFilters
        {...defaultProps}
        selectedGroups={["core-servers"]}
        onGroupsChange={onGroupsChange}
      />,
    );

    expect(screen.getByText("core-servers")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /remove core-servers/i }));
    expect(onGroupsChange).toHaveBeenCalledWith([]);
  });

  it("closes group popover on Escape", async () => {
    render(<StatefulFilters initial={["core-servers"]} groupOptions={defaultProps.groupOptions} onChange={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /groups/i }));
    expect(screen.getByRole("checkbox", { name: /core-servers/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox", { name: /core-servers/i })).not.toBeInTheDocument();
  });

  it("searches group options within popover", async () => {
    render(<StatefulFilters groupOptions={defaultProps.groupOptions} onChange={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /groups/i }));
    await user.type(screen.getByTestId("checklist-search"), "dm");
    expect(screen.getByRole("checkbox", { name: /dmz/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /core-servers/i })).not.toBeInTheDocument();
  });

  it("does not call onChange when applying groups (prevents wiping search/status)", async () => {
    onChange.mockClear();
    const onGroupsChange = vi.fn();
    render(<AlertFilters {...defaultProps} onGroupsChange={onGroupsChange} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /groups/i }));
    await user.click(screen.getByRole("checkbox", { name: /core-servers/i }));
    await user.click(screen.getByRole("button", { name: /apply/i }));

    expect(onGroupsChange).toHaveBeenCalledWith(["core-servers"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when clearing groups (prevents wiping search/status)", async () => {
    onChange.mockClear();
    const onGroupsChange = vi.fn();
    render(
      <AlertFilters
        {...defaultProps}
        selectedGroups={["core-servers"]}
        onGroupsChange={onGroupsChange}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /groups/i }));
    await user.click(screen.getByRole("button", { name: /clear/i }));

    expect(onGroupsChange).toHaveBeenCalledWith([]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
