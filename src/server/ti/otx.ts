import "server-only";

import type { TiLookupContext, TiProvider, TiVerdict } from "./provider";

export interface OtxOptions {
  apiKey?: string;
}

export function createOtxProvider(options: OtxOptions = {}): TiProvider {
  return {
    name: "otx",
    async lookup(ctx: TiLookupContext, fetchFn = fetch): Promise<TiVerdict | null> {
      if (ctx.type !== "ip") return null;

      const url = new URL(
        `https://otx.alienvault.com/api/v1/indicators/IPv4/${encodeURIComponent(ctx.indicator)}/general`,
      );
      const headers: Record<string, string> = {};
      if (options.apiKey) headers["X-OTX-API-KEY"] = options.apiKey;

      const res = await fetchFn(url.toString(), { method: "GET", headers });

      if (!res.ok) return null;

      const body = (await res.json()) as {
        pulse_info?: { count?: number };
        reputation?: { reputation?: string | null };
      };

      const pulseCount = body.pulse_info?.count;
      if (typeof pulseCount !== "number") return null;

      return {
        indicator: ctx.indicator,
        type: "ip",
        abuseScore: pulseCount > 0 ? Math.min(pulseCount, 100) : 0,
        abuseCategory: body.reputation?.reputation ?? null,
        pulseCount,
        sources: ["otx"],
      };
    },
  };
}
