import "server-only";

import { eq } from "drizzle-orm";
import type { TiCacheStore, TiVerdict } from "./provider";
import { iocCache } from "../db/schema";
import type { Database } from "../db/types";

export class DbTiCache implements TiCacheStore {
  constructor(private db: Database) {}

  async get(indicator: string, type: string): Promise<TiVerdict | null> {
    const [row] = await this.db
      .select()
      .from(iocCache)
      .where(eq(iocCache.indicator, indicator));
    if (!row) return null;
    return {
      indicator: row.indicator,
      type: row.type as TiVerdict["type"],
      abuseScore: row.abuseScore,
      abuseCategory: row.abuseCategory,
      pulseCount: row.pulseCount,
      sources: row.sources,
    };
  }

  async set(verdict: TiVerdict): Promise<void> {
    await this.db
      .insert(iocCache)
      .values({
        indicator: verdict.indicator,
        type: verdict.type,
        abuseScore: verdict.abuseScore,
        abuseCategory: verdict.abuseCategory,
        pulseCount: verdict.pulseCount,
        sources: verdict.sources,
      })
      .onConflictDoUpdate({
        target: iocCache.indicator,
        set: {
          type: verdict.type,
          abuseScore: verdict.abuseScore,
          abuseCategory: verdict.abuseCategory,
          pulseCount: verdict.pulseCount,
          sources: verdict.sources,
          fetchedAt: new Date(),
        },
      });
  }

  async setMany(verdicts: TiVerdict[]): Promise<void> {
    if (verdicts.length === 0) return;
    await this.db
      .insert(iocCache)
      .values(verdicts.map((v) => ({
        indicator: v.indicator,
        type: v.type,
        abuseScore: v.abuseScore,
        abuseCategory: v.abuseCategory,
        pulseCount: v.pulseCount,
        sources: v.sources,
      })))
      .onConflictDoUpdate({
        target: iocCache.indicator,
        set: {
          type: iocCache.type,
          abuseScore: iocCache.abuseScore,
          abuseCategory: iocCache.abuseCategory,
          pulseCount: iocCache.pulseCount,
          sources: iocCache.sources,
          fetchedAt: new Date(),
        },
      });
  }
}
