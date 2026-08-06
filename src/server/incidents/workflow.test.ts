import { describe, expect, it } from "vitest";
import { getIncidentTransitionMatrix } from "./workflow";

const MATRIX = getIncidentTransitionMatrix();

function canTransition(from: string, to: string): boolean {
  const entry = MATRIX[to as keyof typeof MATRIX];
  return Boolean(entry?.validFrom.includes(from));
}

describe("incident transition matrix (no DB)", () => {
  it("allows open -> investigating, open -> mitigated, and open -> resolved", () => {
    expect(canTransition("open", "investigating")).toBe(true);
    expect(canTransition("open", "mitigated")).toBe(true);
    expect(canTransition("open", "resolved")).toBe(true);
  });

  it("allows investigating -> mitigated and investigating -> open (reopen)", () => {
    expect(canTransition("investigating", "mitigated")).toBe(true);
    expect(canTransition("investigating", "open")).toBe(true);
  });

  it("allows resolved -> open (reopen) and resolved -> investigating", () => {
    expect(canTransition("resolved", "open")).toBe(true);
    expect(canTransition("resolved", "investigating")).toBe(true);
  });

  it("rejects resolved -> mitigated (must reopen/investigate first)", () => {
    expect(canTransition("resolved", "mitigated")).toBe(false);
  });

  it("rejects open -> open as a transition source", () => {
    expect(canTransition("open", "open")).toBe(false);
  });
});
