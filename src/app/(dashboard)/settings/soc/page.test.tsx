/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import SettingsSocPage from "./page";

const BASE_DATA = {
  socAutoAnalyze: true,
  socAutoAnalyzeVulnerabilities: false,
  socAutoAnalyzeMinLevel: 7,
  socAutoCreateIncident: true,
  socAutoIncidentMinConfidence: 0.8,
  socAutoIncidentRequireCorroboration: true,
  tiProviders: "abuseipdb",
  abuseipdbKeySet: false,
  otxKeySet: false,
  greynoiseKeySet: false,
  tiMinLevel: 7,
  tiCacheTtlDays: 30,
  analyzeCooldownSeconds: { "533": 3600 },
  analysisTagScope: { allowTags: ["T1046"], denyTags: ["T1055"] },
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify({ data: BASE_DATA }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  cleanup();
});

describe("SettingsSocPage cooldown editor", () => {
  it("loads existing per-rule cooldown into the textarea as ruleId:minutes", async () => {
    render(<SettingsSocPage />);
    await waitFor(() => {
      const area = screen.getByLabelText("cooldown-per-rule") as HTMLTextAreaElement;
      expect(area.value).toBe("533:60");
    });
  });

  it("submits ruleId:minutes lines as {ruleId: seconds} with a default for the rest", async () => {
    render(<SettingsSocPage />);
    const area = (await screen.findByLabelText("cooldown-per-rule")) as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "533:120\n40103:0" } });
    fireEvent.click(screen.getByText("soc-save"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/settings" && (c[1] as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.analyzeCooldownSeconds).toEqual({ "533": 7200, "40103": 0, "*": 3600 });
    });
  });
});

describe("SettingsSocPage analysis tag scope", () => {
  it("loads existing allow/deny tags into the textareas", async () => {
    render(<SettingsSocPage />);
    await waitFor(() => {
      const allow = screen.getByLabelText("analysis-allow-tags") as HTMLTextAreaElement;
      const deny = screen.getByLabelText("analysis-deny-tags") as HTMLTextAreaElement;
      expect(allow.value).toBe("T1046");
      expect(deny.value).toBe("T1055");
    });
  });

  it("submits allow/deny lines as trimmed, empty-filtered tag arrays", async () => {
    render(<SettingsSocPage />);
    const allow = (await screen.findByLabelText("analysis-allow-tags")) as HTMLTextAreaElement;
    const deny = (await screen.findByLabelText("analysis-deny-tags")) as HTMLTextAreaElement;
    fireEvent.change(allow, { target: { value: "T1046\n\nT1059\n" } });
    fireEvent.change(deny, { target: { value: "T1055\nT1562" } });
    fireEvent.click(screen.getByText("soc-save"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/settings" && (c[1] as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.analysisTagScope).toEqual({ allowTags: ["T1046", "T1059"], denyTags: ["T1055", "T1562"] });
    });
  });

  it("trims whitespace and tabs from allow/deny tag lines", async () => {
    render(<SettingsSocPage />);
    const allow = (await screen.findByLabelText("analysis-allow-tags")) as HTMLTextAreaElement;
    const deny = (await screen.findByLabelText("analysis-deny-tags")) as HTMLTextAreaElement;
    fireEvent.change(allow, { target: { value: " T1046 \n\tT1059\t\n" } });
    fireEvent.change(deny, { target: { value: " T1055 " } });
    fireEvent.click(screen.getByText("soc-save"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/settings" && (c[1] as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.analysisTagScope).toEqual({ allowTags: ["T1046", "T1059"], denyTags: ["T1055"] });
    });
  });

  it("submits empty tag inputs as empty arrays", async () => {
    render(<SettingsSocPage />);
    const allow = (await screen.findByLabelText("analysis-allow-tags")) as HTMLTextAreaElement;
    const deny = (await screen.findByLabelText("analysis-deny-tags")) as HTMLTextAreaElement;
    fireEvent.change(allow, { target: { value: "" } });
    fireEvent.change(deny, { target: { value: "" } });
    fireEvent.click(screen.getByText("soc-save"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/settings" && (c[1] as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.analysisTagScope).toEqual({ allowTags: [], denyTags: [] });
    });
  });
});
