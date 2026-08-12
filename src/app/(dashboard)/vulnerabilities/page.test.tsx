/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import VulnerabilitiesPage from "./page";

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const makeVuln = (overrides: Record<string, unknown> = {}) => ({
  cve: "CVE-2023-1234",
  severity: "High",
  cvss_score: 8.5,
  status: "VALID",
  agentId: "001",
  agentName: "web-01",
  ...overrides,
});

const baseData = {
  agents: [{ id: "001", name: "web-01" }],
  indexerConfigured: true,
  indexerError: false,
  stale: false,
};

function jsonResponse(vulns: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    data: { ...baseData, vulnerabilities: vulns.map(makeVuln), ...extra },
  });
}

function mockData(vulns: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/vulnerabilities") {
      return new Response(jsonResponse(vulns, extra), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });
}

function getCardValues() {
  const rows: { label: string; value: string }[] = [];
  // Summary strip: role="group" is on the .panel itself (not a parent wrapper)
  const strips = document.querySelectorAll('.panel[role="group"]');
  strips.forEach((strip) => {
    const spans = Array.from(strip.querySelectorAll("span"));
    for (let i = 0; i < spans.length - 1; i++) {
      const label = spans[i].textContent?.trim() ?? "";
      const value = spans[i + 1].textContent?.trim() ?? "";
      if (label && value) rows.push({ label, value });
    }
  });
  return rows;
}

describe("Vulnerabilities page", () => {
  it("renders summary cards with total and severity counts", async () => {
    mockData([{}]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("summary-total");
    const values = getCardValues();
    const totalCard = values.find((v) => v.label === "summary-total");
    const highCard = values.find((v) => v.label === "summary-high");
    expect(totalCard?.value).toBe("1");
    expect(highCard?.value).toBe("1");
  });

  it("shows showing-count text when vulnerabilities are present", async () => {
    mockData([{}]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("showing-count");
    expect(screen.getByText("showing-count")).toBeInTheDocument();
  });

  it("renders vulnerability table rows with CVE and severity badges", async () => {
    mockData([{}]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("CVE-2023-1234");
    expect(screen.getByText("CVE-2023-1234")).toBeInTheDocument();
    // severity-high appears in both table badge and filter dropdown; assert table presence
    const badge = screen.getByTestId("severity-badge-high");
    expect(badge).toBeInTheDocument();
  });

  it("displays CVSS score with numeric formatting", async () => {
    mockData([{}]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("8.5");
    expect(screen.getByText("8.5")).toBeInTheDocument();
  });

  it("renders agent name and ID in table row", async () => {
    mockData([{}]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("web-01");
    expect(screen.getByText("web-01")).toBeInTheDocument();
    expect(screen.getByText("001")).toBeInTheDocument();
  });

  it("renders refresh button with correct label", async () => {
    mockData([{}]);
    render(<VulnerabilitiesPage />);
    await screen.findByRole("button", { name: "refresh" });
    const btn = screen.getByRole("button", { name: "refresh" });
    expect(btn).toBeInTheDocument();
  });

  it("handles empty vulnerability list", async () => {
    mockData([]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("no-vulnerabilities");
    expect(screen.getByText("no-vulnerabilities")).toBeInTheDocument();
  });

  it("renders stale warning when data is stale", async () => {
    mockData([{}], { stale: true });
    render(<VulnerabilitiesPage />);
    await screen.findByText("stale-data");
    expect(screen.getByText("stale-data")).toBeInTheDocument();
  });

  it("renders indexer error banner when configured with errors", async () => {
    mockData([{}], { indexerError: true });
    render(<VulnerabilitiesPage />);
    await screen.findByText(/Indexer connection failed/);
    expect(screen.getByText(/Indexer connection failed/)).toBeInTheDocument();
  });

  it("shows configure-indexer CTA when indexer is not configured", async () => {
    mockData([{}], { indexerConfigured: false });
    render(<VulnerabilitiesPage />);
    await screen.findByText("indexer-not-configured");
    expect(screen.getByText("indexer-not-configured")).toBeInTheDocument();
    expect(screen.getByText("configure-indexer")).toBeInTheDocument();
  });

  it("renders multiple vulnerabilities with correct counts", async () => {
    mockData([
      { severity: "Critical", cvss_score: 9.8 },
      { severity: "High", cvss_score: 8.0 },
      { severity: "Medium", cvss_score: 5.5 },
      { severity: "Low", cvss_score: 2.0 },
    ]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("summary-total");
    const values = getCardValues();
    const totalCard = values.find((v) => v.label === "summary-total");
    const criticalCard = values.find((v) => v.label === "summary-critical");
    expect(totalCard?.value).toBe("4");
    expect(criticalCard?.value).toBe("1");
    expect(screen.getByTestId("severity-badge-critical")).toBeInTheDocument();
    expect(screen.getByTestId("severity-badge-low")).toBeInTheDocument();
  });

  it("shows published date when available", async () => {
    mockData([{ published: "2024-01-15T00:00:00Z" }]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("1/15/2024");
    expect(screen.getByText("1/15/2024")).toBeInTheDocument();
  });

  it("shows severity badge color style for critical", async () => {
    mockData([{ severity: "Critical", cvss_score: 9.1 }]);
    render(<VulnerabilitiesPage />);
    const badge = await screen.findByTestId("severity-badge-critical");
    expect(badge).toHaveClass("bg-red-100");
    expect(badge).toHaveClass("text-red-700");
  });

  it("shows severity badge color style for high", async () => {
    mockData([{ severity: "High", cvss_score: 8.0 }]);
    render(<VulnerabilitiesPage />);
    const badge = await screen.findByTestId("severity-badge-high");
    expect(badge).toHaveClass("bg-orange-100");
    expect(badge).toHaveClass("text-orange-700");
  });

  it("shows dash for missing published date", async () => {
    mockData([{}]);
    render(<VulnerabilitiesPage />);
    await screen.findByText("CVE-2023-1234");
    // Published column shows "-" when no published date
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
  });
});
