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
    wazuhTimestamp: new Date(),
    ingestedAt: new Date(),
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

afterEach(cleanup);

describe("AlertTable", () => {
  it("renders loading, empty, and data states", () => {
    const { rerender } = render(
      <AlertTable status="loading" alerts={[]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    expect(screen.getByText("Loading alerts…")).toBeInTheDocument();

    rerender(
      <AlertTable status="success" alerts={[]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    expect(screen.getByText(/No alerts match/)).toBeInTheDocument();
  });

  it("shows severity badges with correct color and label", () => {
    const { rerender } = render(
      <AlertTable status="success" alerts={[makeAlert({ level: 15, groups: [] })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    const badge = screen.getByRole("generic", { name: /severity critical/i });
    expect(badge).toHaveStyle({ backgroundColor: "#DC2626" });
    expect(badge).toHaveTextContent("Critical");

    rerender(
      <AlertTable status="success" alerts={[makeAlert({ level: 12 })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    const highBadge = screen.getByRole("generic", { name: /severity high/i });
    expect(highBadge).toHaveStyle({ backgroundColor: "#EA580C" });

    rerender(
      <AlertTable status="success" alerts={[makeAlert({ level: 7 })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    const medBadge = screen.getByRole("generic", { name: /severity medium/i });
    expect(medBadge).toHaveStyle({ backgroundColor: "#D97706" });

    rerender(
      <AlertTable status="success" alerts={[makeAlert({ level: 6 })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    const lowBadge = screen.getByRole("generic", { name: /severity low/i });
    expect(lowBadge).toHaveStyle({ backgroundColor: "#2563EB" });
  });

  it("renders group badges", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ groups: ["core-servers", "dmz"] })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    expect(screen.getByText("core-servers")).toBeInTheDocument();
    expect(screen.getByText("dmz")).toBeInTheDocument();
  });

  it("renders '-' for both groups and tags columns when empty", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ groups: [], tags: [] })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    expect(screen.getByRole("columnheader", { name: "Groups" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Agent groups" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Tags" })).toBeInTheDocument();
  });

  it("renders tag badges when tags are present", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ tags: ["critical", "ssh"] })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("ssh")).toBeInTheDocument();
  });

  it("renders '-' when no tags", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ tags: [] })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    expect(screen.getAllByText("-")[0]).toBeInTheDocument();
  });

  it("renders a clickable row when onOpenDetail is provided", () => {
    const handler = vi.fn();
    render(
      <AlertTable status="success" alerts={[makeAlert({ ruleDescription: "SSH brute force" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} onOpenDetail={handler} />
    );
    const btn = screen.getByRole("button", { name: /view details for ssh brute force/i });
    expect(btn).toBeInTheDocument();
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ ruleDescription: "SSH brute force" }));
  });

  it("renders Reopen button for acknowledged alert when canModify and onReopen provided", () => {
    const handler = vi.fn();
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "acknowledged" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} onReopen={handler} canModify={true} />
    );
    const reopenBtn = screen.getByRole("button", { name: /^Reopen/ });
    expect(reopenBtn).toBeInTheDocument();
    reopenBtn.click();
    expect(handler).toHaveBeenCalledWith("a1");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("renders Reopen button for resolved alert", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "resolved" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} onReopen={vi.fn()} canModify={true} />
    );
    expect(screen.getByRole("button", { name: /^Reopen/ })).toBeInTheDocument();
  });

  it("does not render Reopen for open alert", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "open" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} onReopen={vi.fn()} canModify={true} />
    );
    expect(screen.queryByRole("button", { name: /^Reopen/ })).not.toBeInTheDocument();
  });

  it("does not render Reopen when canModify is false", () => {
    render(
      <AlertTable status="success" alerts={[makeAlert({ status: "acknowledged" })]} onAcknowledge={vi.fn()} onResolve={vi.fn()} onReopen={vi.fn()} canModify={false} />
    );
    expect(screen.queryByRole("button", { name: /^Reopen/ })).not.toBeInTheDocument();
  });
});
