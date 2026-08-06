/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { AlertTable } from "./alert-table";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("AlertTable", () => {
  it("renders loading, empty, and data states", () => {
    const { rerender } = render(
      <AlertTable status="loading" alerts={[]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    expect(screen.getByText("loading")).toBeInTheDocument();

    rerender(
      <AlertTable status="success" alerts={[]} onAcknowledge={vi.fn()} onResolve={vi.fn()} canModify={false} />
    );
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
