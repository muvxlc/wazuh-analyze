import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./invite-service";

describe("invite inputs", () => {
  it("normalizes email for uniqueness while preserving display email separately", () => {
    expect(normalizeEmail(" Admin@Example.COM ")).toBe("admin@example.com");
  });
});
