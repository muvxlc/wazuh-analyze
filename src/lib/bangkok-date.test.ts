import { describe, it, expect } from "vitest";
import { toBangkokDate } from "./bangkok-date";

describe("toBangkokDate", () => {
  it("returns YYYY-MM-DD without offset for UTC midnight", () => {
    // 2026-08-05T00:00:00Z -> 2026-08-05T07:00+07:00 -> 2026-08-05
    expect(toBangkokDate("2026-08-05T00:00:00Z")).toBe("2026-08-05");
  });

  it("rolls the date forward across midnight boundary", () => {
    // 2026-08-05T18:00:00Z -> 2026-08-06T01:00+07:00 -> 2026-08-06
    expect(toBangkokDate("2026-08-05T18:00:00Z")).toBe("2026-08-06");
  });

  it("rolls the date backward before midnight boundary", () => {
    // 2026-08-05T17:00:00Z -> 2026-08-06T00:00+07:00 -> 2026-08-06
    expect(toBangkokDate("2026-08-05T17:00:00Z")).toBe("2026-08-06");
  });

  it("does not include a timezone offset suffix", () => {
    const out = toBangkokDate("2026-08-05T00:00:00Z");
    expect(out).not.toMatch(/[+\-]\d{2}:\d{2}$/);
    expect(out).not.toMatch(/Z$/);
  });

  it("returns null for null input", () => {
    expect(toBangkokDate(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toBangkokDate("")).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(toBangkokDate("not-a-date")).toBeNull();
  });
});
