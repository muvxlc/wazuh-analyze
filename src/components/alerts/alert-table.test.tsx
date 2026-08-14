/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { AlertTable } from "./alert-table";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function makeAlert(overrides: Partial<{ level: number; groups: string[]; tags: string[]; ruleDescription: string; ruleId: string; agentName: string; status: string; id: string }> = {}) {
  return {
    id: "a1",
    wazuhEventId: null,
    fingerprint: "",
    wazuhTimestamp: new Date("2026-08-13T11:00:00Z"),
    ingestedAt: new Date("2026-08-13T11:00:00Z"),
    agentId: "001",
    agentName: overrides.agentName ?? "web-01",
    agentIp: null,
    ruleId: overrides.ruleId ?? "100001",
    ruleDescription: overrides.ruleDescription ?? "SSH brute force",
    level: overrides.level ?? 7,
    groups: overrides.groups ?? ["core-servers"],
    tags: overrides.tags ?? [],
    compliance: {},
    status: (overrides.status ?? "open") as "open" | "acknowledged" | "resolved",
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    resolvedAt: null,
    resolvedByUserId: null,
    rawPayload: {},
  };
}

const NOW = Date.parse("2026-08-13T12:00:00Z");

afterEach(cleanup);

describe("AlertTable", () => {
  it("renders loading, empty, and data states", () => {
    const { rerender } = render(
      <AlertTable status="loading" alerts={[]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    expect(screen.getByText("Loading alerts…")).toBeInTheDocument();

    rerender(
      <AlertTable status="success" alerts={[]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    expect(screen.getByText(/No alerts match/)).toBeInTheDocument();
  });

  it("shows severity badges with correct color and label", () => {
    const { rerender } = render(
      <AlertTable status="success" alerts={[makeAlert({ level: 15, groups: [] })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    const badge = screen.getByRole("generic", { name: /severity critical/i });
    expect(badge).toHaveStyle({ backgroundColor: "#DC2626" });
    expect(badge).toHaveTextContent("Critical");

    rerender(
      <AlertTable status="success" alerts={[makeAlert({ level: 12 })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    expect(screen.getByRole("generic", { name: /severity high/i })).toHaveStyle({ backgroundColor: "#EA580C" });

    rerender(
      <AlertTable status="success" alerts={[makeAlert({ level: 7 })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    expect(screen.getByRole("generic", { name: /severity medium/i })).toHaveStyle({ backgroundColor: "#D97706" });

    rerender(
      <AlertTable status="success" alerts={[makeAlert({ level: 6 })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    expect(screen.getByRole("generic", { name: /severity low/i })).toHaveStyle({ backgroundColor: "#2563EB" });
  });

  it("renders agent + rule meta line", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ agentName: "dmz-01", ruleId: "5501" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    expect(screen.getByText(/dmz-01/)).toBeInTheDocument();
    expect(screen.getByText(/5501/)).toBeInTheDocument();
  });

  it("renders relative time in the Time column", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert()]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    // 1h ago for 11:00 vs now 12:00
    expect(screen.getByText("1h ago")).toBeInTheDocument();
  });

  it("renders a status pill", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "acknowledged" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    expect(screen.getByText("acknowledged")).toBeInTheDocument();
  });

  it("renders a clickable title when onOpenDetail is provided", () => {
    const handler = vi.fn();
    render(
      <AlertTable status="success" alerts={[makeAlert({ ruleDescription: "SSH brute force" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} onOpenDetail={handler} now={NOW} />
    );
    const btn = screen.getByRole("button", { name: /SSH brute force/ });
    expect(btn).toBeInTheDocument();
    btn.click();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ ruleDescription: "SSH brute force" }));
  });

  it("renders Reopen button for acknowledged alert when canModify and onReopen provided", () => {
    const handler = vi.fn();
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "acknowledged" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} onReopen={handler} canModify={true} now={NOW} />
    );
    const reopenBtn = screen.getByRole("button", { name: /^Reopen/ });
    reopenBtn.click();
    expect(handler).toHaveBeenCalledWith("a1");
  });

  it("renders Reopen button for resolved alert", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "resolved" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} onReopen={vi.fn()} canModify={true} now={NOW} />
    );
    expect(screen.getByRole("button", { name: /^Reopen/ })).toBeInTheDocument();
  });

  it("does not render Reopen for open alert", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "open" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} onReopen={vi.fn()} canModify={true} now={NOW} />
    );
    expect(screen.queryByRole("button", { name: /^Reopen/ })).not.toBeInTheDocument();
  });

  it("does not render actions when canModify is false", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "open" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} now={NOW} />
    );
    expect(screen.queryByRole("button", { name: /^Ack/ })).not.toBeInTheDocument();
  });
});
