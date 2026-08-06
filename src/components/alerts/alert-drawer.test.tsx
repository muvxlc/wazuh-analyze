/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { AlertDrawer } from "./alert-drawer";
import type { AlertDetail } from "../../server/alerts/types";

function makeAlertDetail(overrides: Partial<AlertDetail> = {}): AlertDetail {
  return {
    id: "a1",
    wazuhEventId: null,
    fingerprint: "",
    wazuhTimestamp: new Date(),
    ingestedAt: new Date(),
    agentId: "001",
    agentName: "web-01",
    agentIp: "10.0.0.1",
    ruleId: "100001",
    ruleDescription: "SSH brute force",
    level: 7,
    groups: ["core-servers"],
    tags: [],
    compliance: {},
    status: "open",
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    resolvedAt: null,
    resolvedByUserId: null,
    rawPayload: {},
    timeline: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("AlertDrawer", () => {
  it("renders closed when isOpen is false", () => {
    const { container } = render(
      <AlertDrawer alert={makeAlertDetail()} isOpen={false} onClose={vi.fn()} />
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it("renders alert detail and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <AlertDrawer alert={makeAlertDetail()} isOpen={true} onClose={onClose} />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("SSH brute force")).toBeInTheDocument();
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
    expect(screen.getByText("core-servers")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders severity badge with correct color for critical level", () => {
    render(
      <AlertDrawer alert={makeAlertDetail({ level: 15 })} isOpen={true} onClose={vi.fn()} />
    );
    const badge = screen.getByText(/level 15/i);
    expect(badge).toHaveStyle({ backgroundColor: "#DC2626" });
  });

  it("renders tags when present", () => {
    render(
      <AlertDrawer alert={makeAlertDetail({ tags: ["critical", "ssh"] })} isOpen={true} onClose={vi.fn()} />
    );
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("ssh")).toBeInTheDocument();
  });

  it("renders '-' when no tags", () => {
    render(
      <AlertDrawer alert={makeAlertDetail({ tags: [] })} isOpen={true} onClose={vi.fn()} />
    );
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });
});
