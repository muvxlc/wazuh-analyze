import "server-only";

import type { IocType, TiLookupContext, TiProvider, TiVerdict } from "./provider";

export interface OtxOptions {
  apiKey?: string;
}

/** OTX API path suffix per indicator type. Non-IP types hit the generic endpoint. */
const PATH_SUFFIX: Record<IocType, string> = {
  ip: "IPv4",
  domain: "domain",
  hash: "fileSHA256", // OTX accepts SHA256 for hash; MD5 falls through as a secondary attempt
};

export function createOtxProvider(options: OtxOptions = {}): TiProvider {
  return {
    name: "otx",
    async lookup(ctx: TiLookupContext, fetchFn = fetch): Promise<TiVerdict | null> {
      // OTX requires the API key for every indicator type.
      if (!options.apiKey) return null;

      const suffix = PATH_SUFFIX[ctx.type];
      const url = new URL(
        `https://otx.alienvault.com/api/v1/indicators/${suffix}/${encodeURIComponent(ctx.indicator)}/general`,
      );

      const res = await fetchFn(url.toString(), {
        method: "GET",
        headers: { "X-OTX-API-KEY": options.apiKey },
      });

      // Not found / invalid indicator → no verdict (not an error).
      if (res.status === 404) return null;
      if (!res.ok) return null;

      const body = (await res.json()) as {
        pulse_info?: { count?: number };
        reputation?: { reputation?: string | null };
      };

      const pulseCount = body.pulse_info?.count;
      if (typeof pulseCount !== "number") return null;

      return {
        indicator: ctx.indicator,
        type: ctx.type,
        abuseScore: pulseCount > 0 ? Math.min(pulseCount, 100) : 0,
        abuseCategory: body.reputation?.reputation ?? null,
        pulseCount,
        sources: ["otx"],
      };
    },
  };
}
