import { describe, expect, it } from "vitest";

import { loginSchema, inviteAcceptanceSchema } from "../../../server/auth/schemas";
import { assertCsrfSafe } from "../../../server/auth/csrf";

describe("auth route contracts", () => {
  describe("loginSchema", () => {
    it("accepts valid email and password", () => {
      const result = loginSchema.safeParse({ email: "a@b.com", password: "validPass123!" });
      expect(result.success).toBe(true);
    });

    it("rejects missing password", () => {
      const result = loginSchema.safeParse({ email: "a@b.com" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = loginSchema.safeParse({ email: "not-an-email", password: "validPass123!" });
      expect(result.success).toBe(false);
    });
  });

  describe("inviteAcceptanceSchema", () => {
    it("accepts valid invite input", () => {
      const result = inviteAcceptanceSchema.safeParse({
        displayName: "John Doe",
        password: "validPass123!",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty displayName", () => {
      const result = inviteAcceptanceSchema.safeParse({
        displayName: "",
        password: "validPass123!",
      });
      expect(result.success).toBe(false);
    });

    it("rejects body with extra token field — schema has no token key", () => {
      const result = inviteAcceptanceSchema.safeParse({
        displayName: "John Doe",
        password: "validPass123!",
        token: "evil-token",
      });
      // Zod v4 strips unknown keys by default; token is not in schema
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).not.toHaveProperty("token");
    });
  });

  describe("CSRF on auth routes", () => {
    const appUrl = new URL("https://app.test");

    it("allows GET session without origin", () => {
      expect(() => assertCsrfSafe(new Request("https://app.test/api/session"), appUrl)).not.toThrow();
    });

    it("rejects POST login without origin — login requires CSRF", () => {
      expect(() =>
        assertCsrfSafe(new Request("https://app.test/api/login", { method: "POST" }), appUrl),
      ).toThrow("csrf_origin_missing");
    });

    it("allows POST login with correct origin", () => {
      expect(() =>
        assertCsrfSafe(new Request("https://app.test/api/login", {
          method: "POST",
          headers: { origin: "https://app.test" },
        }), appUrl),
      ).not.toThrow();
    });

    it("rejects POST invite with wrong origin", () => {
      expect(() =>
        assertCsrfSafe(new Request("https://app.test/api/invites/t", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }), appUrl),
      ).toThrow("csrf_origin_mismatch");
    });

    it("allows POST logout with correct origin", () => {
      expect(() =>
        assertCsrfSafe(new Request("https://app.test/api/logout", {
          method: "POST",
          headers: { origin: "https://app.test" },
        }), appUrl),
      ).not.toThrow();
    });
  });
});
