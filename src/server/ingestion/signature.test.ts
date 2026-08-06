import { describe, expect, it, vi } from "vitest";

import { extractWebhookHeaders, verifyWebhookRequest } from "./signature";
import { computeHmacSha256Hex } from "./signature";
import { AppError } from "../errors";
import type { SignedWebhookRequest } from "./signature";

describe("signature", () => {
  const secret = new TextEncoder().encode("test-secret");
  const now = new Date("2026-08-02T10:00:00Z"); // fixed for determinism

  describe("extractWebhookHeaders", () => {
    it("returns null for missing headers", () => {
      const req = new Request("https://example.com/api", {
        method: "POST",
        headers: new Headers(),
      });
      const { timestamp, signature } = extractWebhookHeaders(req);
      expect(timestamp).toBeNull();
      expect(signature).toBeNull();
    });

    it("extracts headers case-insensitively", () => {
      const req = new Request("https://example.com/api", {
        method: "POST",
        headers: new Headers({
          "x-wazuh-timestamp": "12345",
          "X-WAZUH-SIGNATURE": "sha256=deadbeef",
        }),
      });
      const { timestamp, signature } = extractWebhookHeaders(req);
      expect(timestamp).toBe("12345");
      expect(signature).toBe("sha256=deadbeef");
    });
  });

  describe("verifyWebhookRequest", () => {
    const baseBody = '{"id":"fixture-1","rule":{"level":7,"id":"100001","description":"Fixture"},"agent":{"id":"001","name":"agent-1"},"timestamp":"2026-08-02T00:00:00Z"}';
    const baseBodyBuf = new Uint8Array(Buffer.from(baseBody, "utf8"));
    const validTimestamp = "1785664800"; // 2026-08-02T10:00:00Z (matches fixed `now`)

    it("accepts valid signature", () => {
      const validSig = "sha256=4337c174eafb19079a75b03a299b45153aa325f5afd1f1edf9def04f0e6d5e97";
      const input: SignedWebhookRequest = {
        body: baseBodyBuf,
        timestamp: validTimestamp,
        signature: validSig,
      };
      expect(() =>
        verifyWebhookRequest({ request: input, secret, now, maxAgeMs: 5_000 })
      ).not.toThrow();
    });

    it("rejects missing timestamp header", () => {
      const input: SignedWebhookRequest = {
        body: baseBodyBuf,
        timestamp: null,
        signature: "sha256=4337c174eafb19079a75b03a299b45153aa325f5afd1f1edf9def04f0e6d5e97",
      };
      expect(() =>
        verifyWebhookRequest({ request: input, secret, now, maxAgeMs: 5_000 })
      ).toThrowError(/missing_webhook_headers/);
    });

    it("rejects missing signature header", () => {
      const input: SignedWebhookRequest = {
        body: baseBodyBuf,
        timestamp: validTimestamp,
        signature: null,
      };
      expect(() =>
        verifyWebhookRequest({ request: input, secret, now, maxAgeMs: 5_000 })
      ).toThrowError(/missing_webhook_headers/);
    });

    it("rejects invalid timestamp format", () => {
      const input: SignedWebhookRequest = {
        body: baseBodyBuf,
        timestamp: "not-a-number",
        signature: "sha256=4337c174eafb19079a75b03a299b45153aa325f5afd1f1edf9def04f0e6d5e97",
      };
      expect(() =>
        verifyWebhookRequest({ request: input, secret, now, maxAgeMs: 5_000 })
      ).toThrowError(/invalid_timestamp/);
    });

    it("rejects expired timestamp", () => {
      const expired = String(Math.floor(Date.now() / 1000) - 400); // 400s ago
      const input: SignedWebhookRequest = {
        body: baseBodyBuf,
        timestamp: expired,
        signature: "sha256=4337c174eafb19079a75b03a299b45153aa325f5afd1f1edf9def04f0e6d5e97",
      };
      expect(() =>
        verifyWebhookRequest({ request: input, secret, now, maxAgeMs: 300 })
      ).toThrowError(/timestamp_expired/);
    });

    it("rejects invalid signature prefix", () => {
      const input: SignedWebhookRequest = {
        body: baseBodyBuf,
        timestamp: validTimestamp,
        signature: "md5=4337c174eafb19079a75b03a299b45153aa325f5afd1f1edf9def04f0e6d5e97",
      };
      expect(() =>
        verifyWebhookRequest({ request: input, secret, now, maxAgeMs: 5_000 })
      ).toThrowError(/invalid_signature_format/);
    });

    it("rejects malformed hex", () => {
      const input: SignedWebhookRequest = {
        body: baseBodyBuf,
        timestamp: validTimestamp,
        signature: "sha256=zzzz",
      };
      expect(() =>
        verifyWebhookRequest({ request: input, secret, now, maxAgeMs: 5_000 })
      ).toThrowError(/invalid_signature_format/);
    });

    it("rejects wrong signature via timing-safe compare", () => {
      const input: SignedWebhookRequest = {
        body: baseBodyBuf,
        timestamp: validTimestamp,
        signature: "sha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      };
      expect(() =>
        verifyWebhookRequest({ request: input, secret, now, maxAgeMs: 5_000 })
      ).toThrowError(/signature_mismatch/);
    });
  });

  describe("computeHmacSha256Hex", () => {
    it("matches fixture vector (basic)", () => {
      const secretBuf = new TextEncoder().encode("test-secret");
      const bodyBuf = new Uint8Array(
        Buffer.from(
          '{"id":"fixture-1","rule":{"level":7,"id":"100001","description":"Fixture"},"agent":{"id":"001","name":"agent-1"},"timestamp":"2026-08-02T00:00:00Z"}',
          "utf8"
        )
      );
      const hex = computeHmacSha256Hex(secretBuf, bodyBuf);
      expect(hex).toBe("4337c174eafb19079a75b03a299b45153aa325f5afd1f1edf9def04f0e6d5e97");
    });

    it("detects whitespace change", () => {
      const secretBuf = new TextEncoder().encode("test-secret");
      const bodyBuf1 = new Uint8Array(
        Buffer.from(
          '{"id":"fixture-1","rule":{"level":7,"id":"100001","description":"Fixture"},"agent":{"id":"001","name":"agent-1"},"timestamp":"2026-08-02T00:00:00Z"}',
          "utf8"
        )
      );
      const bodyBuf2 = new Uint8Array(
        Buffer.from(
          ' {"id":"fixture-1","rule":{"level":7,"id":"100001","description":"Fixture"},"agent":{"id":"001","name":"agent-1"},"timestamp":"2026-08-02T00:00:00Z"} ',
          "utf8"
        )
      );
      expect(computeHmacSha256Hex(secretBuf, bodyBuf1)).not.toBe(
        computeHmacSha256Hex(secretBuf, bodyBuf2)
      );
    });
  });
});