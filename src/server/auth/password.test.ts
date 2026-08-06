import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password authentication", () => {
  it("hashes and verifies a Unicode password without trimming it", async () => {
    const password = "  SecuréPassphrase-123 ";
    const hash = await hashPassword(password);

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, password)).resolves.toBe(true);
    await expect(verifyPassword(hash, password.trim())).resolves.toBe(false);
  });

  it("rejects short and common passwords", async () => {
    await expect(hashPassword("short")).rejects.toMatchObject({ code: "invalid_password" });
    await expect(hashPassword("passwordpassword")).rejects.toMatchObject({ code: "invalid_password" });
  });
});
