// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionEditor } from "./permission-editor";

describe("PermissionEditor", () => {
  it("renders inherited, allowed, and denied states", () => {
    render(
      <PermissionEditor
        defaults={["alerts.read"]}
        overrides={[
          { permission: "alerts.resolve", effect: "allow" },
          { permission: "agents.read", effect: "deny" },
        ]}
      />
    );
    expect(screen.getAllByText("Inherited").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Allowed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Denied").length).toBeGreaterThan(0);
  });
});
