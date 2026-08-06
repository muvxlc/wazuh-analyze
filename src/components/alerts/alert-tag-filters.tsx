"use client";

import { useState, useEffect, useCallback } from "react";
import { ChecklistPopover, type ChecklistOption } from "../../components/ui/checklist-popover";
import { SelectedChips } from "../../components/ui/selected-chips";

interface TagFilterProps {
  onChange: (tags: string[]) => void;
  initialTags?: string[];
  allTagsEndpoint?: string;
}

export function AlertTagFilters({ onChange, initialTags = [], allTagsEndpoint = "/api/agent-tags" }: TagFilterProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(allTagsEndpoint)
      .then((res) => res.ok ? res.json() : null)
      .then((body: { data?: { tags?: string[] } } | null) => {
        if (!cancelled && body?.data?.tags) {
          setAllTags(body.data.tags);
          if (body.data.tags.length === 0) setAvailable(false);
        }
      })
      .catch(() => setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, [allTagsEndpoint]);

  const handleApply = useCallback(
    (next: string[]) => {
      setSelectedTags(next);
      onChange(next);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    setSelectedTags([]);
    onChange([]);
  }, [onChange]);

  if (!available || allTags.length === 0) return null;

  const options: ChecklistOption[] = allTags.map((tag) => ({ value: tag, label: tag }));
  const selected = selectedTags.length > 0
    ? allTags.filter((t) => selectedTags.includes(t)).map((t) => ({ value: t, label: t }))
    : [];

  return (
    <div className="tag-filter" role="group" aria-label="Filter by agent tags">
      <div className="tag-filter-header">
        <span className="tag-filter-label">Tags:</span>
        <ChecklistPopover
          ariaLabel="Filter by agent tags"
          options={options}
          selected={selectedTags}
          onApply={handleApply}
          onClear={handleClear}
          trigger={({ open, toggle, selectedCount }) => (
            <button
              type="button"
              className={`outline-button tag-trigger ${open ? "tag-trigger--open" : ""}`}
              onClick={toggle}
              aria-expanded={open}
            >
              Tags ({selectedCount})
            </button>
          )}
        />
      </div>
      {selected.length > 0 && (
        <div className="tag-chips">
          <SelectedChips
            items={selected}
            onRemove={(value) => {
              const next = selectedTags.filter((t) => t !== value);
              setSelectedTags(next);
              onChange(next);
            }}
          />
        </div>
      )}
    </div>
  );
}
