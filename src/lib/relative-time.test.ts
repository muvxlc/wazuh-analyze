import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  formatAbsoluteTime,
  isNew,
  DEFAULT_NEW_THRESHOLD_MINUTES,
} from "./relative-time";

// Fixed "now": 2026-08-13T12:00:00Z
const NOW = Date.parse("2026-08-13T12:00:00Z");

describe("formatRelativeTime", () => {
  it("returns 'just now' for <45s", () => {
    expect(formatRelativeTime("2026-08-13T11:59:30Z", NOW)).toBe("just now");
  });

  it("returns minutes", () => {
    expect(formatRelativeTime("2026-08-13T11:55:00Z", NOW)).toBe("5m ago");
  });

  it("returns hours", () => {
    expect(formatRelativeTime("2026-08-13T10:00:00Z", NOW)).toBe("2h ago");
  });

  it("returns days under a week", () => {
    expect(formatRelativeTime("2026-08-10T12:00:00Z", NOW)).toBe("3d ago");
  });

  it("falls back to absolute for >=7 days", () => {
    const out = formatRelativeTime("2026-08-01T12:00:00Z", NOW);
    expect(out).not.toMatch(/ago$/);
    expect(out).toMatch(/2026/);
  });

  it("returns em-dash for invalid input", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("—");
    expect(formatRelativeTime(null, NOW)).toBe("—");
  });
});

describe("formatAbsoluteTime", () => {
  it("returns a formatted timestamp containing the year", () => {
    expect(formatAbsoluteTime("2026-08-13T12:00:00Z")).toMatch(/2026/);
  });

  it("returns em-dash for invalid input", () => {
    expect(formatAbsoluteTime("garbage")).toBe("—");
  });
});

describe("isNew", () => {
  it("true within the default threshold", () => {
    // 5 minutes ago, default 15
    expect(isNew("2026-08-13T11:55:00Z", NOW)).toBe(true);
  });

  it("false beyond the default threshold", () => {
    // 20 minutes ago, default 15
    expect(isNew("2026-08-13T11:40:00Z", NOW)).toBe(false);
  });

  it("respects a custom threshold", () => {
    // 30 minutes ago, threshold 60 -> new
    expect(isNew("2026-08-13T11:30:00Z", NOW, 60)).toBe(true);
    // 30 minutes ago, threshold 15 -> not new
    expect(isNew("2026-08-13T11:30:00Z", NOW, 15)).toBe(false);
  });

  it("false for invalid input", () => {
    expect(isNew(null, NOW)).toBe(false);
    expect(isNew("bad", NOW)).toBe(false);
  });

  it("DEFAULT_NEW_THRESHOLD_MINUTES is 15", () => {
    expect(DEFAULT_NEW_THRESHOLD_MINUTES).toBe(15);
  });
});
