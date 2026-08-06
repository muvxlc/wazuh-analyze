/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import LocalPage from "./page";

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

beforeEach(() => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/settings" && (!init || init.method === undefined)) {
      return new Response(
        JSON.stringify({
          data: {
            retentionDays: 90,
            maintenanceBatchSize: 1000,
            nodeEnv: "development",
            appUrl: "http://localhost:3000",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "/api/settings" && init?.method === "PATCH") {
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });
});

describe("Settings local page", () => {
  it("renders editable retention and batch size fields with current values", async () => {
    render(<LocalPage />);
    const retention = await screen.findByLabelText("local-retention-days");
    expect(retention).toHaveValue(90);
    const batch = await screen.findByLabelText("local-maintenance-batch-size");
    expect(batch).toHaveValue(1000);
  });

  it("posts to /api/settings via PATCH on save with expected keys", async () => {
    const user = userEvent.setup();
    render(<LocalPage />);
    await screen.findByLabelText("local-retention-days");
    await user.click(screen.getByRole("button", { name: "local-save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    const patchCall = fetchMock.mock.calls.find(
      ([u, o]) => u === "/api/settings" && (o as RequestInit)?.method === "PATCH",
    );
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body).toHaveProperty("alertRetentionDays");
    expect(body).toHaveProperty("maintenanceBatchSize");
  });

  it("shows success message after save", async () => {
    const user = userEvent.setup();
    render(<LocalPage />);
    await screen.findByLabelText("local-retention-days");
    await user.click(screen.getByRole("button", { name: "local-save" }));
    expect(await screen.findByText("local-save-success")).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    fetchMock.mockImplementation(async () => new Response("error", { status: 500 }));
    render(<LocalPage />);
    expect(await screen.findByText("fetch-error")).toBeInTheDocument();
  });
});
