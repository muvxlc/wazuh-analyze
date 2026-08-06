import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedPayload {
  /** Base64 (no padding) IV. */
  iv: string;
  /** Base64 (no padding) ciphertext + auth tag concatenated. */
  data: string;
}

function encodeB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeB64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function deriveKey(secret: string): Uint8Array {
  // ponytail: SHA-256 derivation lets short-but-valid secrets encrypt cleanly.
  // Upgrade to scrypt + per-tenant salt if keys ever span deployments.
  const hash = createHash("sha256").update(secret).digest();
  if (hash.length !== 32) throw new Error("invalid derived key length");
  return hash as unknown as Uint8Array;
}

export function encryptSecret(plaintext: string, secret: string): EncryptedPayload {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: encodeB64(iv), data: encodeB64(Buffer.concat([enc, tag])) };
}

export function decryptSecret(payload: EncryptedPayload, secret: string): string {
  if (!payload || typeof payload.iv !== "string" || typeof payload.data !== "string") {
    throw new DecryptionError("invalid_encrypted_payload");
  }
  const key = deriveKey(secret);
  const iv = decodeB64(payload.iv);
  if (iv.length !== IV_BYTES) throw new DecryptionError("invalid_iv_length");
  const combined = decodeB64(payload.data);
  if (combined.length < TAG_BYTES) throw new DecryptionError("invalid_ciphertext_length");
  const ciphertext = combined.subarray(0, combined.length - TAG_BYTES);
  const tag = combined.subarray(combined.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(tag));
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
  } catch {
    throw new DecryptionError("auth_tag_failed");
  }
  return plain.toString("utf8");
}

export class DecryptionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DecryptionError";
  }
}

export function secretEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
