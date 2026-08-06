import { describe, expect, it } from "vitest";

import { assertCsrfSafe } from "./csrf";

describe("CSRF origin validation", () => {
  it("accepts the configured exact origin", () => {
    expect(() => assertCsrfSafe(new Request("https://app.test/api", {
      method: "POST",
      headers: { origin: "https://app.test" },
    }), new URL("https://app.test"))).not.toThrow();
  });

  it("rejects a cross-origin mutation", () => {
    expect(() => assertCsrfSafe(new Request("https://app.test/api", {
      method: "POST",
      headers: { origin: "https://evil.test" },
    }), new URL("https://app.test"))).toThrowError("csrf_origin_mismatch");
  });

  it("rejects missing origins on cookie-authenticated mutations", () => {
    expect(() => assertCsrfSafe(new Request("https://app.test/api", { method: "DELETE" }), new URL("https://app.test")))
      .toThrowError("csrf_origin_missing");
  });
});
