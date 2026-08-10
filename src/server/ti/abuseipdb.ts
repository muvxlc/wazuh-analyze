import "server-only";

import type { TiCacheStore, TiLookupContext, TiProvider, TiVerdict } from "./provider";

export interface AbuseIpDbOptions {
  apiKey?: string;
  maxAgeInDays?: number;
}

export function createAbuseIpDbProvider(options: AbuseIpDbOptions = {}): TiProvider {
  return {
    name: "abuseipdb",
    async lookup(ctx: TiLookupContext, fetchFn = fetch): Promise<TiVerdict | null> {
      if (ctx.type !== "ip" || !options.apiKey) return null;

      const url = new URL("https://api.abuseipdb.com/api/v2/check");
      url.searchParams.set("ipAddress", ctx.indicator);
      url.searchParams.set("maxAgeInDays", String(options.maxAgeInDays ?? 90));

      const res = await fetchFn(url.toString(), {
        method: "GET",
        headers: {
          Key: options.apiKey,
          Accept: "application/json",
        },
      });

      if (res.status === 429 || !res.ok) {
        // Fail open on rate-limit or HTTP error so alerts still process without TI
        return null;
      }

      const body = (await res.json()) as {
        data?: {
          ipAddress?: string;
          abuseConfidenceScore?: number;
          totalReports?: number;
        };
      };

      if (!body?.data || typeof body.data.abuseConfidenceScore !== "number") {
        return null;
      }

      return {
        indicator: ctx.indicator,
        type: "ip",
        abuseScore: body.data.abuseConfidenceScore,
        abuseCategory: body.data.totalReports ? `${body.data.totalReports} reports` : null,
        pulseCount: null,
        sources: ["abuseipdb"],
      };
    },
  };
}

/**
 * Feeds local ioc_cache from the AbuseIPDB daily blacklist (10k IPs) for zero-latency,
 * unlimited offline lookups. Call once a day via cron/bg job.
 * ponytail: store blacklist categories + last-modified ETags when bandwidth becomes a bottleneck.
 */
export async function refreshAbuseIpDbBlacklist(
  apiKey: string,
  cache: TiCacheStore,
  options: { limit?: number; confidenceMinimum?: number; fetchFn?: typeof fetch } = {},
): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = new URL("https://api.abuseipdb.com/api/v2/blacklist");
  url.searchParams.set("limit", String(options.limit ?? 10_000));
  url.searchParams.set("confidenceMinimum", String(options.confidenceMinimum ?? 75));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res;
  try {
    res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { Key: apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return 0;
  const body = (await res.json()) as {
    data?: Array<{ ipAddress: string; abuseConfidenceScore: number }>;
  };

  if (!Array.isArray(body?.data)) return 0;
  let count = 0;
  for (const row of body.data) {
    if (!row.ipAddress) continue;
    await cache.set({
      indicator: row.ipAddress,
      type: "ip",
      abuseScore: row.abuseConfidenceScore ?? 100,
      abuseCategory: "blacklist",
      pulseCount: null,
      sources: ["abuseipdb:blacklist"],
    });
    count++;
  }
  return count;
}
