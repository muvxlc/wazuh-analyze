import { describe, expect, it } from "vitest";

import { createSessionToken, hashSessionToken, sessionExpiry } from "./session";

describe("opaque sessions", () => {
  it("creates URL-safe random tokens and hashes them", () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashSessionToken(token)).not.toContain(token);
  });

  it("uses twelve-hour idle and seven-day absolute expiry", () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    expect(sessionExpiry(now).idle.toISOString()).toBe("2026-08-03T12:00:00.000Z");
    expect(sessionExpiry(now).absolute.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("absolute expiry is strictly greater than idle expiry", () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const { idle, absolute } = sessionExpiry(now);
    expect(absolute.getTime()).toBeGreaterThan(idle.getTime());
  });
});
