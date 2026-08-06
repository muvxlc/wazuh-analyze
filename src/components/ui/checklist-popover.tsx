"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover } from "./popover";

export interface ChecklistOption {
  value: string;
  label: string;
}

export interface ChecklistPopoverProps {
  trigger: (props: { open: boolean; toggle: () => void; selectedCount: number }) => ReactNode;
  options: readonly ChecklistOption[];
  selected: readonly string[];
  onApply: (selected: string[]) => void;
  onClear: () => void;
  ariaLabel: string;
  /** Placeholder shown in search input. */
  searchPlaceholder?: string;
}

export function ChecklistPopover({
  trigger,
  options,
  selected,
  onApply,
  onClear,
  ariaLabel,
  searchPlaceholder = "Search",
}: ChecklistPopoverProps) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(() => []);
  const inputRef = useRef<HTMLInputElement>(null);

  const visibleOptions = useMemo(() => {
    if (!query.trim()) return options;
    const needle = query.toLowerCase();
    return options.filter(
      (opt) => opt.value.toLowerCase().includes(needle) || opt.label.toLowerCase().includes(needle),
    );
  }, [options, query]);

  // Re-initialise draft when the controlled selection changes — forces a full
  // re-mount so the panel reflects the new selection immediately without
  // cascading renders.
  const key = selected.join(",");

  const handleOpen = useCallback(() => {
    setDraft([...selected]);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [selected]);

  const toggleItem = useCallback((value: string) => {
    setDraft((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }, []);

  const handleApply = useCallback(() => {
    onApply(draft);
  }, [draft, onApply]);

  const handleClear = useCallback(() => {
    setDraft([]);
    onClear();
  }, [onClear]);

  return (
    <Popover
      key={key}
      ariaLabel={ariaLabel}
      onOpenChange={handleOpen}
      trigger={(props) => trigger({ ...props, selectedCount: draft.length })}
    >
      {({ close }) => (
        <div className="checklist-popover">
          <div className="checklist-search-row">
            <input
              ref={inputRef}
              type="text"
              className="checklist-search-input"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="checklist-search"
            />
            <button
              type="button"
              className="outline-button checklist-clear"
              onClick={handleClear}
              data-testid="checklist-clear"
            >
              Clear
            </button>
          </div>
          <ul className="checklist-options" role="listbox" aria-multiselectable>
            {visibleOptions.length === 0 && (
              <li className="checklist-empty">
                <span>No results</span>
              </li>
            )}
            {visibleOptions.map((opt) => {
              const active = draft.includes(opt.value);
              return (
                <li key={opt.value} role="option" aria-selected={active}>
                  <label className="checklist-option-label">
                    <input
                      type="checkbox"
                      className="checklist-option-input"
                      checked={active}
                      onChange={() => toggleItem(opt.value)}
                      aria-label={opt.label}
                    />
                    <span className="checklist-option-text" title={opt.label}>{opt.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="checklist-footer">
            <span className="checklist-selection-count" aria-live="polite">
              {draft.length} selected
            </span>
            <button type="button" className="primary-button" onClick={handleApply} data-testid="checklist-apply">
              Apply
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
