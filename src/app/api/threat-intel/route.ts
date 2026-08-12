import "server-only";

import { and, asc, desc, ilike, or, sql } from "drizzle-orm";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { iocCache } from "../../../server/db/schema";
import { toErrorResponse } from "../../../server/http/error-response";

const types = new Set(["ip", "hash", "domain"]);
const sorts = new Set(["score", "newest", "oldest"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Cursor encoding: "<abuseScore>_<fetchedAt>". Sorted by score desc then fetchedAt desc.
 * For "newest"/"oldest" sort: cursor uses fetchedAt desc only (score is secondary).
 */
function encodeCursor(score: number | null, fetchedAt: Date): string {
  const key = typeof score === "number" ? String(score) : "-1";
  return `${key}_${fetchedAt.toISOString()}`;
}

function parseCursor(cursor?: string): { score: number; fetchedAt: Date } | null {
  if (!cursor) return null;
  const idx = cursor.indexOf("_");
  if (idx === -1) return null;
  const score = Number(cursor.slice(0, idx));
  const fetchedAt = new Date(cursor.slice(idx + 1));
  if (isNaN(score) || isNaN(fetchedAt.getTime())) return null;
  return { score, fetchedAt };
}

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const token = request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
    const user = await authenticateRequest(db, token);
    requirePermission(user.permissions, "ti.read");

    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim() ?? "";
    const type = params.get("type") ?? "all";
    const sort = params.get("sort") ?? "score";
    if (!sorts.has(sort)) return Response.json({ error: "invalid_sort" }, { status: 400 });
    const limitRaw = params.get("limit") === null ? NaN : Number(params.get("limit"));
    const limit = Math.min(Math.max(isNaN(limitRaw) ? DEFAULT_LIMIT : limitRaw, 1), MAX_LIMIT);
    const cursor = parseCursor(params.get("cursor") ?? undefined);

    const conditions = [];
    if (query) conditions.push(or(ilike(iocCache.indicator, `%${query}%`), ilike(iocCache.abuseCategory, `%${query}%`)));
    if (types.has(type)) conditions.push(sql`${iocCache.type} = ${type}`);

    // Cursor conditions added to WHERE for deterministic ordering
    const cursorCondition = cursor
      ? sort === "oldest"
        ? sql`${iocCache.fetchedAt} > ${cursor.fetchedAt}`
        : sort === "newest"
          ? sql`${iocCache.fetchedAt} < ${cursor.fetchedAt}`
          : sql`${iocCache.abuseScore} < ${cursor.score} OR (${iocCache.abuseScore} = ${cursor.score} AND ${iocCache.fetchedAt} < ${cursor.fetchedAt})`
      : undefined;

    const orderBy = sort === "newest"
      ? [desc(iocCache.fetchedAt)]
      : sort === "oldest"
        ? [asc(iocCache.fetchedAt)]
        : [desc(iocCache.abuseScore), desc(iocCache.fetchedAt)];

    const rows = await db.select({
      indicator: iocCache.indicator,
      type: iocCache.type,
      abuseScore: iocCache.abuseScore,
      abuseCategory: iocCache.abuseCategory,
      pulseCount: iocCache.pulseCount,
      sources: iocCache.sources,
      fetchedAt: iocCache.fetchedAt,
      ttlDays: iocCache.ttlDays,
      expired: sql<boolean>`fetched_at + (ttl_days || ' days')::interval < NOW()`,
    }).from(iocCache)
      .where(conditions.length
        ? and(...conditions, cursorCondition)
        : cursorCondition)
      .orderBy(...orderBy)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    const nextCursor = hasMore && items.length > 0
      ? encodeCursor(items[items.length - 1].abuseScore ?? -1, items[items.length - 1].fetchedAt)
      : null;

    return Response.json({
      data: {
        indicators: items,
        query,
        type,
        sort,
        limit,
        cursor: nextCursor,
        hasMore,
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
