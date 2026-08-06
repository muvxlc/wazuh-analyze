/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { AlertAnalysisPanel } from "./alert-analysis-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AlertAnalysisPanel", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });
  });

  it("renders empty state when no analysis exists", async () => {
    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={true} />);
    expect(await screen.findByTestId("empty-verdict")).toBeInTheDocument();
    expect(screen.getByTestId("analyze-btn")).toBeInTheDocument();
  });

  it("hides analyze button when canAnalyze is false", async () => {
    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={false} />);
    expect(await screen.findByTestId("empty-verdict")).toBeInTheDocument();
    expect(screen.queryByTestId("analyze-btn")).not.toBeInTheDocument();
  });

  it("displays existing analysis fetched on mount", async () => {
    const verdict = { summary: "Threat detected", confidence: 0.9, severity: "high", mitreAttack: [{ techniqueId: "T1110", techniqueName: "Brute Force" }] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "ans-1", verdict }] }),
    });
    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={true} />);
    expect(await screen.findByTestId("verdict-content")).toBeInTheDocument();
    expect(screen.getByText(/Threat detected/)).toBeInTheDocument();
    expect(screen.getByText(/T1110/)).toBeInTheDocument();
  });

  it("triggers analysis on button click and updates view", async () => {
    const newVerdict = { summary: "Newly analyzed threat", confidence: 0.85, recommendedActions: ["Block IP"] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { verdict: newVerdict } }) });
    globalThis.fetch = fetchMock;

    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={true} />);
    const btn = await screen.findByTestId("analyze-btn");
    fireEvent.click(btn);

    expect(await screen.findByText(/Newly analyzed threat/)).toBeInTheDocument();
    expect(screen.getByText(/Block IP/)).toBeInTheDocument();
  });
});
