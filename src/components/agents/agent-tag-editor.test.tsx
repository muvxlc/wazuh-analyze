/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { AgentTagEditor } from "./agent-tag-editor";

function makeTags(...tags: string[]) {
  return tags.map((tag, i) => ({
    id: `tag-${i}`,
    agentId: "001",
    tag,
    createdByUserId: "user-1",
    createdAt: new Date(),
  }));
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = typeof url === "string" ? url : url.pathname;
      const method = init?.method ?? "GET";
      if (path.includes("/api/agent-tags") && method === "GET") {
        return json({ data: { tags: ["core", "dmz", "prod"] } });
      }
      if (path.includes("/tags") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.tags) {
          return json({
            data: {
              tags: body.tags.map((tag: string, i: number) => ({
                id: `persisted-${i}`,
                agentId: "001",
                tag,
                createdByUserId: "user-1",
                createdAt: new Date().toISOString(),
              })),
            },
          });
        }
        return json({ data: { added: [], removed: [] } });
      }
      if (path.includes("/tags") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return json({ data: {} });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderEditor(overrides: Partial<React.ComponentProps<typeof AgentTagEditor>> = {}) {
  const onChange = vi.fn();
  return {
    ...render(
      <AgentTagEditor
        agentId="001"
        initialTags={makeTags("core", "dmz")}
        onChange={onChange}
        {...overrides}
      />,
    ),
    onChange,
  };
}

describe("AgentTagEditor", () => {
  it("renders existing tags as chips", () => {
    renderEditor();
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.getByText("dmz")).toBeInTheDocument();
  });

  it("shows empty state for agent with no tags", () => {
    renderEditor({ initialTags: [] });
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("renders readOnly mode as simple chips", () => {
    renderEditor({ readOnly: true });
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
  });

  it("opens manage popover and shows search input", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /manage/i }));
    expect(screen.getByTestId("manage-tags-search")).toBeInTheDocument();
  });

  it("closes manage popover on Escape", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /manage/i }));
    expect(screen.getByTestId("manage-tags-search")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("manage-tags-search")).not.toBeInTheDocument();
  });

  it("toggles draft items and applies changes via bulk POST", async () => {
    const { onChange } = renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /manage/i }));
    // Uncheck core by clicking the label
    await user.click(screen.getByLabelText("core"));
    // Verify checkbox is now unchecked
    await waitFor(() => {
      expect(screen.getByLabelText("core")).not.toBeChecked();
    });
    await user.click(screen.getByTestId("manage-tags-apply"));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    const applied = onChange.mock.calls[0][0] as { tag: string }[];
    expect(applied.map((t) => t.tag)).toEqual(["dmz"]);
    // Verify bulk POST was called with {tags}
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
    const postCall = calls.find((call) => call[1]?.method === "POST" && typeof call[1]!.body === "string" && call[1]!.body!.includes('"tags"'));
    expect(postCall).toBeDefined();
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({ tags: ["dmz"] });
  });

  it("clears all tags via the popover", async () => {
    const { onChange } = renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /manage/i }));
    await user.click(screen.getByLabelText("core"));
    await user.click(screen.getByLabelText("dmz"));
    await waitFor(() => {
      expect(screen.getByLabelText("core")).not.toBeChecked();
      expect(screen.getByLabelText("dmz")).not.toBeChecked();
    });
    await user.click(screen.getByTestId("manage-tags-apply"));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toEqual([]);
    });
  });

  it("creates a new tag via the popover and applies it", async () => {
    const { onChange } = renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /manage/i }));
    await user.type(screen.getByTestId("manage-tags-search"), "new-tag");
    await user.click(screen.getByRole("button", { name: /create "new-tag"/i }));
    await user.click(screen.getByTestId("manage-tags-apply"));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
      const applied = onChange.mock.calls[0][0] as { tag: string }[];
      expect(applied.map((t) => t.tag)).toContain("new-tag");
    });
  });

  it("removes a tag directly from chips", async () => {
    const { onChange } = renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /remove tag core/i }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
      const applied = onChange.mock.calls[0][0] as { tag: string }[];
      expect(applied.map((t) => t.tag)).toEqual(["dmz"]);
    });
  });
});
