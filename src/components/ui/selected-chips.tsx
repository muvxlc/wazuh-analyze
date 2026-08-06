"use client";

export interface SelectedChipsProps {
  items: readonly { value: string; label: string }[];
  onRemove?: (value: string) => void;
  emptyLabel?: string;
}

export function SelectedChips({ items, onRemove, emptyLabel }: SelectedChipsProps) {
  if (items.length === 0 && emptyLabel) {
    return <span className="muted chips-empty">{emptyLabel}</span>;
  }
  if (items.length === 0) return null;
  return (
    <ul className="chips" aria-label="Selected filters">
      {items.map((item) => (
        <li key={item.value} className="chip">
          <span className="chip-text">{item.label}</span>
          {onRemove && (
            <button
              type="button"
              className="chip-remove"
              onClick={() => onRemove(item.value)}
              aria-label={`Remove ${item.label}`}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
