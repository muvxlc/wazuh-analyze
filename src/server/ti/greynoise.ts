import "server-only";

import type { TiLookupContext, TiProvider, TiVerdict } from "./provider";

export interface GreyNoiseOptions {
  apiKey?: string;
}

/**
 * GreyNoise v3 community provider. IP-centric — maps cleanly onto the existing
 * `lookupIp` pipeline. Fail-open on rate-limit/auth/error so alerts still process.
 */
export function createGreyNoiseProvider(options: GreyNoiseOptions = {}): TiProvider {
  return {
    name: "greynoise",
    async lookup(ctx: TiLookupContext, fetchFn = fetch): Promise<TiVerdict | null> {
      if (ctx.type !== "ip" || !options.apiKey) return null;

      const url = `https://api.greynoise.io/v3/community/${encodeURIComponent(ctx.indicator)}`;

      let res: Response;
      try {
        res = await fetchFn(url, {
          method: "GET",
          headers: {
            key: options.apiKey,
            Accept: "application/json",
          },
        });
      } catch {
        // Network failure fail-open — mirrors provider philosophy.
        return null;
      }

      if (res.status === 429 || res.status === 403 || !res.ok) {
        return null;
      }

      let body: {
        ip?: string;
        noise?: boolean;
        riot?: boolean;
        classification?: "malicious" | "benign" | "unknown" | string;
        name?: string | null;
        link?: string;
        last_seen?: string;
        message?: string;
      };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // Non-JSON 2xx body (e.g. HTML error page) — fail-open.
        return null;
      }

      if (!body || typeof body !== "object") return null;

      const classification = body.classification;
      let abuseScore: number | null;
      if (classification === "malicious") abuseScore = 90;
      else if (classification === "benign") abuseScore = 0;
      else abuseScore = null;

      const abuseCategory = body.name
        ? `${body.name}${body.noise ? " · noise" : ""}`
        : body.noise
          ? "internet-scanner (noise)"
          : null;

      return {
        indicator: ctx.indicator,
        type: "ip",
        abuseScore,
        abuseCategory,
        pulseCount: null,
        sources: ["greynoise"],
      };
    },
  };
}
