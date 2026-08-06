import { describe, expect, it } from "vitest";

import {
  deriveKey,
  encryptSecret,
  decryptSecret,
  secretEqual,
  DecryptionError,
} from "./encryption";

const TEST_KEY = "test-encryption-key-that-is-at-least-32-characters-long";
const PLAINTEXT = "s3cret-s3ss10n-k3y";

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("deriveKey", () => {
  it("produces a 32-byte key", () => {
    expect(deriveKey(TEST_KEY)).toHaveLength(32);
  });

  it("is deterministic for the same input", () => {
    expect(toHex(deriveKey(TEST_KEY))).toBe(toHex(deriveKey(TEST_KEY)));
  });

  it("differs for different inputs", () => {
    expect(toHex(deriveKey(TEST_KEY))).not.toBe(toHex(deriveKey(TEST_KEY + "x")));
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips plaintext", () => {
    const payload = encryptSecret(PLAINTEXT, TEST_KEY);
    expect(payload).toHaveProperty("iv");
    expect(payload).toHaveProperty("data");
    expect(decryptSecret(payload, TEST_KEY)).toBe(PLAINTEXT);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret(PLAINTEXT, TEST_KEY);
    const b = encryptSecret(PLAINTEXT, TEST_KEY);
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
    expect(decryptSecret(a, TEST_KEY)).toBe(PLAINTEXT);
    expect(decryptSecret(b, TEST_KEY)).toBe(PLAINTEXT);
  });

  it("rejects wrong key with DecryptionError", () => {
    const payload = encryptSecret(PLAINTEXT, TEST_KEY);
    expect(() =>
      decryptSecret(payload, "wrong-key-that-is-also-32-characters-long"),
    ).toThrow(DecryptionError);
  });

  it("rejects tampered ciphertext", () => {
    const payload = encryptSecret(PLAINTEXT, TEST_KEY);
    const bytes = Buffer.from(payload.data, "base64");
    bytes[0] ^= 0xff;
    payload.data = bytes.toString("base64");
    expect(() => decryptSecret(payload, TEST_KEY)).toThrow(DecryptionError);
  });

  it("rejects tampered auth tag", () => {
    const payload = encryptSecret(PLAINTEXT, TEST_KEY);
    const bytes = Buffer.from(payload.data, "base64");
    bytes[bytes.length - 1] ^= 0x01;
    payload.data = bytes.toString("base64");
    expect(() => decryptSecret(payload, TEST_KEY)).toThrow(DecryptionError);
  });

  it("rejects empty payload", () => {
    expect(() => decryptSecret({ iv: "", data: "" }, TEST_KEY)).toThrow(DecryptionError);
  });

  it("rejects missing fields", () => {
    expect(() => decryptSecret({} as never, TEST_KEY)).toThrow(DecryptionError);
    expect(() => decryptSecret({ iv: "abc" } as never, TEST_KEY)).toThrow(DecryptionError);
    expect(() => decryptSecret({ data: "abc" } as never, TEST_KEY)).toThrow(DecryptionError);
  });

  it("handles empty string plaintext", () => {
    const payload = encryptSecret("", TEST_KEY);
    expect(decryptSecret(payload, TEST_KEY)).toBe("");
  });

  it("handles unicode plaintext", () => {
    const unicode = "สวัสดีครับ 🔐";
    const payload = encryptSecret(unicode, TEST_KEY);
    expect(decryptSecret(payload, TEST_KEY)).toBe(unicode);
  });
});

describe("secretEqual", () => {
  it("returns true for identical strings", () => {
    expect(secretEqual("abc", "abc")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(secretEqual("abc", "abd")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(secretEqual("abc", "ab")).toBe(false);
  });
});
