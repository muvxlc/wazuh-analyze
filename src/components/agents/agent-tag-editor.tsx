"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { AgentTag } from "../../server/wazuh/agent-tags";
import { Popover } from "../ui/popover";

interface TagEditorProps {
  agentId: string;
  initialTags?: AgentTag[];
  readOnly?: boolean;
  allTagsEndpoint?: string;
  onChange?: (tags: AgentTag[]) => void;
}

const TAG_PATTERN = /^[a-zA-Z0-9_\-./]+$/;

export function AgentTagEditor({
  agentId,
  initialTags = [],
  readOnly = false,
  allTagsEndpoint = "/api/agent-tags",
  onChange,
}: TagEditorProps) {
  const [tags, setTags] = useState<AgentTag[]>(initialTags);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(() => initialTags.map((t) => t.tag));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(allTagsEndpoint)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: { tags?: string[] } } | null) => {
        if (!cancelled && body?.data?.tags) setAllTags(body.data.tags);
      })
      .catch(() => {
        // tags list optional — creation still works
      });
    return () => {
      cancelled = true;
    };
  }, [allTagsEndpoint]);

  // Re-mount the popover panel when tags change so the draft reflects the
  // current agent selection. The key is derived from tag IDs to avoid
  // re-mounting on re-renders with the same tags.
  const panelKey = tags.map((t) => t.id).join(",");

  const handleOpen = useCallback(() => {
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const toggleDraft = useCallback((tag: string) => {
    setDraft((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  const createTag = useCallback(() => {
    const value = query.trim();
    if (!value) return;
    if (value.length > 64 || !TAG_PATTERN.test(value)) {
      setError("Tag may only contain letters, numbers, and _ - . /");
      return;
    }
    setError(null);
    setDraft((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setQuery("");
  }, [query]);

  const apply = useCallback(
    async (close: () => void) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/agents/${agentId}/tags`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tags: draft }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error ?? "Failed to save tags");
        }
        const body = (await res.json()) as {
          data?: { tags?: AgentTag[]; added?: string[]; removed?: string[] };
        };
        // Bulk POST returns added/removed; single-tag legacy also accepted.
        let next: AgentTag[] = body.data?.tags ?? [];
        if (next.length === 0 && body.data?.added) {
          next = body.data.added.map((tag) => ({
            id: crypto.randomUUID(),
            agentId,
            tag,
            createdByUserId: null,
            createdAt: new Date(),
          }));
        }
        setTags(next);
        onChange?.(next);
        // Fold any newly-created tags into the global list so other editors see them.
        setAllTags((prev) => Array.from(new Set([...prev, ...next.map((t) => t.tag)])).sort());
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save tags");
      } finally {
        setLoading(false);
      }
    },
    [agentId, draft, onChange],
  );

  const removeTagDirect = useCallback(
    async (tag: string) => {
      setError(null);
      setLoading(true);
      try {
        const res = await fetch(`/api/agents/${agentId}/tags?tag=${encodeURIComponent(tag)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error ?? "Failed to remove tag");
        }
        setTags((prev) => prev.filter((t) => t.tag !== tag));
        onChange?.(tags.filter((t) => t.tag !== tag));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove tag");
      } finally {
        setLoading(false);
      }
    },
    [agentId, tags, onChange],
  );

  // Options = global tags + any draft tags not in global list, filtered by query.
  const options = useMemo(() => {
    const merged = Array.from(new Set([...allTags, ...draft]));
    if (!query.trim()) return merged;
    const needle = query.toLowerCase();
    return merged.filter((t) => t.toLowerCase().includes(needle));
  }, [allTags, draft, query]);

  if (readOnly) {
    return (
      <div className="agent-tag-editor agent-tag-editor--readonly">
        <ul className="chips chips-compact" aria-label={`Tags for agent ${agentId}`}>
          {tags.length === 0 ? (
            <li className="muted">-</li>
          ) : (
            tags.map((tag) => (
              <li key={tag.id} className="chip chip-readonly">
                <span className="chip-text">{tag.tag}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    );
  }

  return (
    <div className="agent-tag-editor">
      <ul className="chips chips-compact" aria-label={`Tags for agent ${agentId}`}>
        {tags.length === 0 && <li className="muted">-</li>}
        {tags.map((tag) => (
          <li key={tag.id} className="chip">
            <span className="chip-text">{tag.tag}</span>
            <button
              type="button"
              className="chip-remove"
              onClick={() => void removeTagDirect(tag.tag)}
              aria-label={`Remove tag ${tag.tag}`}
              disabled={loading}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <Popover
        key={panelKey}
        ariaLabel={`Manage tags for agent ${agentId}`}
        onOpenChange={handleOpen}
        portal
        trigger={({ open, toggle }) => (
          <button
            type="button"
            className={`outline-button tag-manage-btn ${open ? "tag-manage-btn--open" : ""}`}
            onClick={toggle}
            aria-expanded={open}
            disabled={loading}
          >
            Manage
          </button>
        )}
      >
        {({ close }) => (
          <div className="manage-tags-popover">
            <div className="manage-tags-search">
              <input
                ref={inputRef}
                type="text"
                className="manage-tags-input"
                placeholder="Search or create tag"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (query.trim() && !options.includes(query.trim())) createTag();
                  }
                }}
                data-testid="manage-tags-search"
              />
              {query.trim() && !allTags.includes(query.trim()) && TAG_PATTERN.test(query.trim()) && (
                <button
                  type="button"
                  className="link-button manage-tags-create"
                  onClick={createTag}
                  data-testid="manage-tags-create"
                >
                  + Create &quot;{query.trim()}&quot;
                </button>
              )}
            </div>
            <ul className="checklist-options" role="listbox" aria-multiselectable>
              {options.length === 0 && (
                <li className="checklist-empty">
                  {query.trim() && !TAG_PATTERN.test(query.trim())
                    ? "Invalid characters in tag"
                    : "No tags yet"}
                </li>
              )}
              {options.map((tag) => {
                const active = draft.includes(tag);
                return (
                  <li key={tag} role="option" aria-selected={active}>
                    <label className="checklist-option-label">
                      <input
                        type="checkbox"
                        className="checklist-option-input"
                        checked={active}
                        onChange={() => toggleDraft(tag)}
                      />
                      <span className="checklist-option-text">{tag}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {error && (
              <p className="tag-error" role="alert">
                {error}
              </p>
            )}
            <div className="checklist-footer">
              <button
                type="button"
                className="outline-button"
                onClick={close}
                data-testid="manage-tags-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void apply(close)}
                disabled={loading}
                data-testid="manage-tags-apply"
              >
                {loading ? "Saving…" : "Apply"}
              </button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}
