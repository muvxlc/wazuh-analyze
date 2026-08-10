import "server-only";

import { and, desc, ilike, or, sql } from "drizzle-orm";
import { createDatabase } from "../../../server/db/client";
import { loadConfig } from "../../../server/config";
import { authenticateRequest } from "../../../server/auth/authenticate";
import { requirePermission } from "../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../server/auth/cookies";
import { iocCache } from "../../../server/db/schema";
import { toErrorResponse } from "../../../server/http/error-response";

const types = new Set(["ip", "hash", "domain"]);

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
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 100), 1), 200);
    const conditions = [];
    if (query) conditions.push(or(ilike(iocCache.indicator, `%${query}%`), ilike(iocCache.abuseCategory, `%${query}%`)));
    if (types.has(type)) conditions.push(sql`${iocCache.type} = ${type}`);

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
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(iocCache.abuseScore), desc(iocCache.fetchedAt))
      .limit(limit);

    return Response.json({ data: { indicators: rows, query, type, limit } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
