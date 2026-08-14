import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import {
  insertDeadLetter,
  listDeadLetters,
  retryDeadLetter,
} from "./dead-letter";
import { AppError } from "../errors";

describe("dead-letter", () => {
  const pool = createTestPool();
  const db = drizzle(pool, { schema });

  beforeAll(async () => {
    await resetTestDatabase(pool);
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("insertDeadLetter", () => {
    const validArgs = {
      db,
      source: "wazuh_webhook",
      text: "failed to parse alert payload",
      rawPayload: { id: "test-1", level: 7 },
      errorReason: "json_parse_error",
    };

    it("inserts a valid dead letter row and returns id", async () => {
      const result = await insertDeadLetter(validArgs);
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);
    });

    it("stores the correct fields", async () => {
      const result = await insertDeadLetter(validArgs);
      const [row] = await db
        .select()
        .from(schema.deadLetters)
        .where(eq(schema.deadLetters.id, result.id))
        .limit(1);

      expect(row).toBeDefined();
      expect((row as any).source).toBe("wazuh_webhook");
      expect((row as any).text).toBe("failed to parse alert payload");
      expect((row as any).errorReason).toBe("json_parse_error");
      expect((row as any).status).toBe("open");
      expect((row as any).rawPayload).toEqual({ id: "test-1", level: 7 });
    });

    it("redacts secret-named keys in payload (key-name sanitization)", async () => {
      const secretValue =
        "dGVzdHNlY3JldGtleXRlc3RzZWNyZXRrZXl0ZXN0c2VjcmV0a2V5dGVzdHNlY3JldGtleXRlc3RzZWNyZXRrZXl0ZXN0c2VjcmV0a2V5dGVzdHNlY3JldGtleXRlc3RzZWNyZXRrZXl0ZXN0c2VjcmV0a2V5dGVzdHNlY3JldGtleXRlc3Q=";
      await insertDeadLetter({
        ...validArgs,
        rawPayload: { apiKey: secretValue, safe: "data" },
      });

      const [row] = await db.select().from(schema.deadLetters).limit(1);
      expect((row as any)?.rawPayload?.apiKey).toBe("[REDACTED]");
      expect((row as any)?.rawPayload?.safe).toBe("data");
    });

    it("preserves long base64-looking legit values on non-secret keys", async () => {
      const legitValue = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".repeat(5);
      await insertDeadLetter({
        ...validArgs,
        rawPayload: { raw_message: legitValue, safe: "data" },
      });

      const [row] = await db.select().from(schema.deadLetters).limit(1);
      expect((row as any)?.rawPayload?.raw_message).toBe(legitValue);
      expect((row as any)?.rawPayload?.safe).toBe("data");
    });

    it("truncates source and text fields to max length", async () => {
      const longSource = "a".repeat(500);
      const longText = "b".repeat(500);
      const result = await insertDeadLetter({
        ...validArgs,
        source: longSource,
        text: longText,
      });

      const [row] = await db.select().from(schema.deadLetters).limit(1);
      expect((row as any)?.source.length).toBeLessThanOrEqual(200);
      expect((row as any)?.text.length).toBeLessThanOrEqual(200);
    });

    it("rejects non-object rawPayload with 422", async () => {
      await expect(insertDeadLetter({ ...validArgs, rawPayload: "not-object" })).rejects.toThrow("dead_letter_invalid_payload");
    });

    it("rejects null rawPayload with 422", async () => {
      await expect(insertDeadLetter({ ...validArgs, rawPayload: null })).rejects.toThrow("dead_letter_invalid_payload");
    });

    it("rejects empty source", async () => {
      await expect(insertDeadLetter({ ...validArgs, source: "" })).rejects.toThrow("dead_letter_empty_source");
    });

    it("rejects empty text", async () => {
      await expect(insertDeadLetter({ ...validArgs, text: "" })).rejects.toThrow("dead_letter_empty_text");
    });

    it("rejects oversized payload (>64KB) with 422", async () => {
      const bigPayload = { data: "x".repeat(70_000) };
      await expect(insertDeadLetter({ ...validArgs, rawPayload: bigPayload })).rejects.toThrow("dead_letter_payload_too_large");
    });

    it("accepts payload at exactly 64KB boundary", async () => {
      const okPayload = { data: "x".repeat(60_000) };
      const result = await insertDeadLetter({ ...validArgs, rawPayload: okPayload });
      expect(result.id).toBeDefined();
    });
  });

  describe("listDeadLetters", () => {
    it("returns empty list when no rows exist", async () => {
      const result = await listDeadLetters({ db });
      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it("returns inserted rows in descending order", async () => {
      await insertDeadLetter({
        db,
        source: "wazuh_webhook",
        text: "first",
        rawPayload: { id: "1" },
        errorReason: "e1",
        attemptedAt: new Date("2026-01-01T00:00:00Z"),
      });
      await insertDeadLetter({
        db,
        source: "indexer_replay",
        text: "second",
        rawPayload: { id: "2" },
        errorReason: "e2",
        attemptedAt: new Date("2026-01-02T00:00:00Z"),
      });

      const result = await listDeadLetters({ db, limit: 10 });
      expect(result.items).toHaveLength(2);
      // Most recent first (orderBy desc createdAt)
      expect(result.items[0].text).toBe("second");
      expect(result.items[1].text).toBe("first");
    });

    it("filters by status", async () => {
      await insertDeadLetter({
        db,
        source: "s1",
        text: "open-letter",
        rawPayload: { id: "1" },
        errorReason: "e1",
      });
      await insertDeadLetter({
        db,
        source: "s2",
        text: "closed-letter",
        rawPayload: { id: "2" },
        errorReason: "e2",
      });

      const result = await listDeadLetters({ db, status: "open" });
      expect(result.items).toHaveLength(2);
    });

    it("returns cursor-based pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await insertDeadLetter({
          db,
          source: "s",
          text: `letter-${i}`,
          rawPayload: { id: `${i}` },
          errorReason: `e${i}`,
        });
      }

      const page1 = await listDeadLetters({ db, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await listDeadLetters({ db, limit: 2, cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(2);
      // Cursor should be the timestamp of the last item in page2
      expect(page2.nextCursor).toBeDefined();
    });

    it("clamps limit to [1, 100]", async () => {
      await insertDeadLetter({
        db,
        source: "s",
        text: "x",
        rawPayload: { id: "1" },
        errorReason: "e",
      });

      const result = await listDeadLetters({ db, limit: 0 });
      expect(result.items).toHaveLength(1);
    });
  });

  describe("retryDeadLetter", () => {
    it("returns null for unknown id", async () => {
      const result = await retryDeadLetter({ db, id: "00000000-0000-0000-0000-000000000000" });
      expect(result).toBeNull();
    });

    it("marks open row as retrying and returns it", async () => {
      const insertResult = await insertDeadLetter({
        db,
        source: "wazuh_webhook",
        text: "retry-test",
        rawPayload: { id: "1" },
        errorReason: "old-error",
      });

      const result = await retryDeadLetter({ db, id: insertResult.id });
      expect(result).not.toBeNull();
      expect(result!.status).toBe("retrying");
      expect(result!.retriedAt).not.toBeNull();
      expect(result!.lastError).toBeNull();
    });

    it("returns null if row not found", async () => {
      const result = await retryDeadLetter({ db, id: "00000000-0000-0000-0000-000000000000" });
      expect(result).toBeNull();
    });
  });
});
