import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import * as schema from "../db/schema";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import { computeReplayKeyHash, insertReplayKey, findReplayKey } from "./replay";
import type { DatabaseTransaction } from "../db/types";

describe("replay", () => {
  const pool = createTestPool();
  const db = drizzle(pool, { schema });

  const secret = new TextEncoder().encode("test-secret");
  const timestamp = "1785686400";
  const signature = "sha256=ad5f15c1a2d30032ae1d8775fbd0c7671a57c9471dd9e136ad0d382cdd93e5c3";

  beforeAll(async () => {
    await resetTestDatabase(pool);
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("computeReplayKeyHash", () => {
    it("produces fixed output for canonical input", () => {
      const hash = computeReplayKeyHash(timestamp, signature);
      expect(hash).toBe("ca713f0dfe3c47d2805f9595eb312643d2b6bf29d5371d4ffd7c6b4cdd2236ae");
    });

    it("is deterministic across calls", () => {
      expect(computeReplayKeyHash(timestamp, signature)).toBe(computeReplayKeyHash(timestamp, signature));
    });

    it("differs for different timestamp", () => {
      const alt = computeReplayKeyHash("1785686500", signature);
      expect(alt).not.toBe(computeReplayKeyHash(timestamp, signature));
    });
  });

  describe("insertReplayKey", () => {
    it("inserts and findReplayKey returns it", async () => {
      const keyHash = computeReplayKeyHash(timestamp, signature);
      const expiresAt = new Date(Date.now() + 300_000);

      await db.transaction(async (tx: DatabaseTransaction) => {
        await insertReplayKey(tx, { keyHash, expiresAt });
      });

      const found = await findReplayKey(db, keyHash);
      expect(found).not.toBeNull();
      expect(found!.keyHash).toBe(keyHash);
    });

    it("rejects duplicate key with 23505", async () => {
      const keyHash = computeReplayKeyHash(timestamp, signature);
      const expiresAt = new Date(Date.now() + 300_000);

      await db.transaction(async (tx: DatabaseTransaction) => {
        await insertReplayKey(tx, { keyHash, expiresAt });
      });

      // Inserting same key again should throw 409
      await expect(
        db.transaction(async (tx: DatabaseTransaction) => {
          await insertReplayKey(tx, { keyHash, expiresAt });
        })
      ).rejects.toThrow("replay_rejected");
    });
  });

  describe("findReplayKey", () => {
    it("returns null for unknown key", async () => {
      expect(await findReplayKey(db, "not-a-real-hash")).toBeNull();
    });
  });
});