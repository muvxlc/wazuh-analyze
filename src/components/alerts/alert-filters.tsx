"use client";

import { useState, useCallback } from "react";
import { ChecklistPopover, type ChecklistOption } from "../../components/ui/checklist-popover";
import { SelectedChips } from "../../components/ui/selected-chips";

export function AlertFilters({
  onChange,
  hideLow,
  onToggleHideLow,
  groupOptions = [],
  selectedGroups,
  onGroupsChange,
}: {
  onChange: (filters: { search?: string; status?: string; levelMin?: string; groups?: string }) => void;
  hideLow?: boolean;
  onToggleHideLow?: (hide: boolean) => void;
  groupOptions?: readonly string[];
  selectedGroups?: readonly string[];
  onGroupsChange?: (groups: string[]) => void;
}) {
  const isControlled = selectedGroups !== undefined;
  const groups = (selectedGroups ?? []).length > 0
    ? groupOptions
        .filter((g) => selectedGroups!.includes(g))
        .map((g) => ({ value: g, label: g }))
    : [];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawGroups = isControlled
      ? [...(selectedGroups ?? [])]
      : form.getAll("groups").map(String);
    onChange({
      search: String(form.get("search") || "") || undefined,
      status: String(form.get("status") || "") || undefined,
      levelMin: hideLow ? "4" : undefined,
      groups: rawGroups.length ? rawGroups.join(",") : undefined,
    });
  }

  const handleApplyGroups = useCallback(
    (next: string[]) => onGroupsChange?.(next),
    [onGroupsChange],
  );

  const handleClearGroups = useCallback(() => onGroupsChange?.([]), [onGroupsChange]);

  const popoverOptions: ChecklistOption[] = groupOptions.map((g) => ({
    value: g,
    label: g,
  }));

  return (
    <form suppressHydrationWarning className="panel alert-filters" onSubmit={handleSubmit}>
      <label className="form-field">
        Search
        <input suppressHydrationWarning name="search" placeholder="Rule or agent" />
      </label>
      <label className="form-field">
        Status
        <select name="status" defaultValue="">
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
      </label>
      {groupOptions.length > 0 && (
        <div className="form-field groups-filter-field">
          <legend>Agent groups</legend>
          <ChecklistPopover
            ariaLabel="Filter by agent groups"
            options={popoverOptions}
            selected={selectedGroups ?? []}
            onApply={handleApplyGroups}
            onClear={handleClearGroups}
            trigger={({ open, toggle, selectedCount }) => (
              <button
                type="button"
                className={`outline-button group-trigger ${open ? "group-trigger--open" : ""}`}
                onClick={toggle}
                aria-expanded={open}
              >
                Groups ({selectedCount})
              </button>
            )}
          />
          {groups.length > 0 && (
            <div className="groups-chips">
              <SelectedChips
                items={groups}
                onRemove={(value) => {
                  const next = (selectedGroups ?? []).filter((g) => g !== value);
                  onGroupsChange?.(next);
                }}
              />
            </div>
          )}
        </div>
      )}
      {onToggleHideLow && (
        <label className="form-field hide-low-label">
          <input
            type="checkbox"
            name="hideLow"
            checked={hideLow ?? false}
            onChange={(e) => onToggleHideLow(e.target.checked)}
          />
          Hide Low Severity / Info Logs
        </label>
      )}
      <button type="submit">Filter</button>
    </form>
  );
}
