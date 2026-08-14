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
      json: () => Promise.resolve({ data: [], progress: null }),
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

  it("POST returns queued status and polling resolves with verdict", async () => {
    const newVerdict = { summary: "Newly analyzed threat", confidence: 0.85, recommendedActions: ["Block IP"] };
    const fetchMock = vi.fn()
      // Initial load: empty
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: null }) })
      // POST: 202 queued
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { queued: true, alertId: "a-1" } }) })
      // Poll 1: still running
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: { phase: "loading", status: "running" } }) })
      // Poll 2: completed with verdict
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ id: "ans-2", verdict: newVerdict }], progress: { phase: "completed", status: "done" } }) });
    globalThis.fetch = fetchMock;

    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={true} />);
    const btn = await screen.findByTestId("analyze-btn");
    fireEvent.click(btn);

    // Button should show queued/processing state
    expect(screen.getByTestId("analyze-btn")).toHaveTextContent(/Queued|Processing/);
    // Polling should eventually surface the verdict
    await waitFor(() => {
      expect(screen.getByText(/Newly analyzed threat/)).toBeInTheDocument();
      expect(screen.getByText(/Block IP/)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("shows error when poll returns failed status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: null }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { queued: true, alertId: "a-1" } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: { phase: "failed", status: "error", detail: "AI timeout" } }) });
    globalThis.fetch = fetchMock;

    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={true} />);
    const btn = await screen.findByTestId("analyze-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/AI timeout/)).toBeInTheDocument();
      // Button should be re-enabled after failure
      expect(screen.getByTestId("analyze-btn")).not.toBeDisabled();
    }, { timeout: 5000 });
  });

  it("auto-polls on mount when job is already in progress (queued)", async () => {
    const fetchMock = vi.fn()
      // Initial load: progress already running
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: { phase: "loading", status: "running" } }) })
      // Poll: completed with verdict
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ id: "ans-1", verdict: { summary: "Loaded verdict", confidence: 0.7 } }], progress: { phase: "completed", status: "done" } }) });
    globalThis.fetch = fetchMock;

    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={true} />);

    await waitFor(() => {
      expect(screen.getByText(/Loaded verdict/)).toBeInTheDocument();
    }, { timeout: 5000 });
    // Should have made 2 fetch calls: initial load + one poll
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from POST timeout by checking existing progress and polling", async () => {
    const fetchMock = vi.fn()
      // Initial load: empty
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: null }) })
      // POST: network error (timeout)
      .mockRejectedValueOnce(new Error("Network timeout"))
      // Recovery fetch: progress is still queued
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: { phase: "queued", status: "running" } }) })
      // Poll: completed
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ id: "ans-2", verdict: { summary: "Recovered", confidence: 0.6 } }], progress: { phase: "completed", status: "done" } }) });
    globalThis.fetch = fetchMock;

    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={true} />);
    const btn = await screen.findByTestId("analyze-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/Recovered/)).toBeInTheDocument();
    }, { timeout: 5000 });
    // No error should be shown
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("continues polling after transient network error in poll loop", async () => {
    const fetchMock = vi.fn()
      // Initial load: empty
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: null }) })
      // POST: 202 queued
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { queued: true, alertId: "a-1" } }) })
      // Poll 1: network error — should NOT stop polling
      .mockRejectedValueOnce(new Error("Network error"))
      // Poll 2: still running
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [], progress: { phase: "loading", status: "running" } }) })
      // Poll 3: completed
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ id: "ans-3", verdict: { summary: "After error", confidence: 0.5 } }], progress: { phase: "completed", status: "done" } }) });
    globalThis.fetch = fetchMock;

    render(<AlertAnalysisPanel alertId="a-1" canAnalyze={true} />);
    const btn = await screen.findByTestId("analyze-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/After error/)).toBeInTheDocument();
    }, { timeout: 5000 });
    // Polling should survive transient errors — at least 3 fetch calls after POST
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
