import { describe, expect, it } from "vitest";

import { shouldApplyFp } from "./check";

// checkFpMatch hits the DB and is intentionally NOT unit-tested here — mocking
// drizzle is brittle and gives false confidence. Integration is covered by
// Wave 2 Task B2 (queue wiring) and the manual e2e in plan section B.
// shouldApplyFp is the safety-critical pure gate, so it gets exhaustive coverage.

describe("shouldApplyFp", () => {
  const FLOOR = 12; // Wazuh critical
  const NOW = new Date("2026-08-13T00:00:00Z");
  const FUTURE = new Date("2026-08-27T00:00:00Z");
  const PAST = new Date("2026-08-01T00:00:00Z");

  it("returns true when enabled + unexpired + level below floor", () => {
    expect(
      shouldApplyFp({ enabled: true, expiresAt: FUTURE }, 7, FLOOR, NOW),
    ).toBe(true);
  });

  it("returns false at the floor boundary (level === floor)", () => {
    // NEVER suppress at/above floor — boundary inclusive
    expect(
      shouldApplyFp({ enabled: true, expiresAt: FUTURE }, 12, FLOOR, NOW),
    ).toBe(false);
  });

  it("returns false above the floor (level 13)", () => {
    expect(
      shouldApplyFp({ enabled: true, expiresAt: FUTURE }, 13, FLOOR, NOW),
    ).toBe(false);
  });

  it("returns false when expired (expiresAt in the past)", () => {
    expect(
      shouldApplyFp({ enabled: true, expiresAt: PAST }, 7, FLOOR, NOW),
    ).toBe(false);
  });

  it("returns false when expiresAt is null", () => {
    expect(
      shouldApplyFp({ enabled: true, expiresAt: null }, 7, FLOOR, NOW),
    ).toBe(false);
  });

  it("returns false when disabled (enabled !== true)", () => {
    expect(
      shouldApplyFp({ enabled: false, expiresAt: FUTURE }, 7, FLOOR, NOW),
    ).toBe(false);
  });

  it("returns false when enabled is null", () => {
    expect(
      shouldApplyFp({ enabled: null, expiresAt: FUTURE }, 7, FLOOR, NOW),
    ).toBe(false);
  });

  it("returns false at exact-equal expiry (expiresAt === now uses <=)", () => {
    // boundary: expiry exactly now is already expired
    expect(
      shouldApplyFp({ enabled: true, expiresAt: NOW }, 7, FLOOR, NOW),
    ).toBe(false);
  });

  it("returns false when disabled AND expired (worst case)", () => {
    expect(
      shouldApplyFp({ enabled: false, expiresAt: PAST }, 7, FLOOR, NOW),
    ).toBe(false);
  });

  it("respects a custom floor (e.g. floor 7 blocks level 7)", () => {
    expect(
      shouldApplyFp({ enabled: true, expiresAt: FUTURE }, 7, 7, NOW),
    ).toBe(false);
    expect(
      shouldApplyFp({ enabled: true, expiresAt: FUTURE }, 6, 7, NOW),
    ).toBe(true);
  });
});
