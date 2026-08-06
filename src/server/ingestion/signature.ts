import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors";

export interface SignedWebhookRequest {
  body: Uint8Array;
  timestamp: string | null;
  signature: string | null;
}

/** Header name constants — case-insensitive per HTTP spec */
const HEADER_TIMESTAMP = "x-wazuh-timestamp";
const HEADER_SIGNATURE = "x-wazuh-signature";

/** Prefix expected before hex digest in signature header */
const SIGNATURE_PREFIX = "sha256=";

export function extractWebhookHeaders(request: Request): {
  timestamp: string | null;
  signature: string | null;
} {
  return {
    timestamp: request.headers.get(HEADER_TIMESTAMP),
    signature: request.headers.get(HEADER_SIGNATURE),
  };
}

export function verifyWebhookRequest(input: {
  request: SignedWebhookRequest;
  secret: Uint8Array;
  now: Date;
  maxAgeMs: number;
}): void {
  const { request, secret, now, maxAgeMs } = input;
  const { timestamp, signature, body } = request;

  // -- Missing headers ---------------------------------------------------
  if (timestamp === null || signature === null) {
    throw new AppError("missing_webhook_headers", 401);
  }

  // -- Timestamp freshness --
  const parsedTs = Number(timestamp);
  if (!Number.isInteger(parsedTs) || parsedTs <= 0) {
    throw new AppError("invalid_timestamp", 401);
  }

  const tsDate = new Date(parsedTs * 1000);
  if (isNaN(tsDate.getTime())) {
    throw new AppError("invalid_timestamp", 401);
  }

  const age = Math.abs(now.getTime() - tsDate.getTime());
  if (age > maxAgeMs) {
    throw new AppError("timestamp_expired", 401);
  }

  // -- Signature format --
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    throw new AppError("invalid_signature_format", 401);
  }
  const hexSig = signature.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hexSig)) {
    throw new AppError("invalid_signature_format", 401);
  }

  // -- HMAC verify: raw byte body only (no timestamp in hash input) --
  const expectedBuf = Buffer.from(
    computeHmacSha256Hex(secret, body),
    "hex",
  );
  const receivedBuf = Buffer.from(hexSig, "hex");

  if (expectedBuf.length !== receivedBuf.length) {
    throw new AppError("signature_mismatch", 401);
  }

  if (!timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new AppError("signature_mismatch", 401);
  }
}

/**
 * Compute HMAC-SHA-256 hex string over raw bytes.
 * Signature input = body bytes only. Lowercase hex.
 * Exported for test assertions and cross-language fixture generation.
 */
export function computeHmacSha256Hex(
  secret: Uint8Array,
  body: Uint8Array,
): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}