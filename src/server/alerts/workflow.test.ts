import { describe, expect, it } from "vitest";
import { getTransitionMatrix } from "./workflow";

const MATRIX = getTransitionMatrix();

function canTransition(from: string, to: string): boolean {
  const entry = MATRIX[to as keyof typeof MATRIX];
  return Boolean(entry?.validFrom.includes(from));
}

describe("alert transition matrix", () => {
  it("allows open -> acknowledged and open -> resolved", () => {
    expect(canTransition("open", "acknowledged")).toBe(true);
    expect(canTransition("open", "resolved")).toBe(true);
  });

  it("allows acknowledged -> resolved and acknowledged -> open (reopen)", () => {
    expect(canTransition("acknowledged", "resolved")).toBe(true);
    expect(canTransition("acknowledged", "open")).toBe(true);
  });

  it("allows resolved -> open (reopen)", () => {
    expect(canTransition("resolved", "open")).toBe(true);
  });

  it("rejects resolved -> acknowledged", () => {
    expect(canTransition("resolved", "acknowledged")).toBe(false);
  });

  it("rejects open -> open as a transition source (open is only reachable via reopen)", () => {
    expect(canTransition("open", "open")).toBe(false);
  });
});
