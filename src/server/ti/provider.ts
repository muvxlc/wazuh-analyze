import "server-only";

/** Normalised indicator type. MVP gates on `ip` (alert srcip). */
export type IocType = "ip" | "hash" | "domain";

export interface TiVerdict {
  indicator: string;
  type: IocType;
  /** AbuseIPDB-style confidence 0–100 (max across sources). */
  abuseScore: number | null;
  abuseCategory: string | null;
  /** OTX-style pulse count (sum across sources). */
  pulseCount: number | null;
  sources: string[];
}

export interface TiLookupContext {
  indicator: string;
  type: IocType;
}

export interface TiProvider {
  readonly name: string;
  lookup(ctx: TiLookupContext, fetchFn?: typeof fetch): Promise<TiVerdict | null>;
}

/** Pluggable registry — providers register at boot, resolved by name from config. */
const registry = new Map<string, TiProvider>();

export function registerTiProvider(provider: TiProvider): void {
  registry.set(provider.name, provider);
}

export function getTiProvider(name: string): TiProvider | undefined {
  return registry.get(name);
}

export function resolveTiProviders(names: string[]): TiProvider[] {
  return names
    .map((n) => registry.get(n))
    .filter((p): p is TiProvider => p !== undefined);
}

export function clearTiRegistry(): void {
  registry.clear();
}

/** Minimal config slice the provider factory needs (matches AppConfig.ti). */
export interface TiConfigSlice {
  providers: string[];
  abuseipdbKey: string | null;
  otxKey: string | null;
}

/**
 * Builds TI providers from a config slice. Unknown provider names are ignored
 * (logged elsewhere if needed). This is the seam analyze-service uses.
 */
export async function buildTiProviders(config: TiConfigSlice): Promise<TiProvider[]> {
  const names = new Set(config.providers);
  const providers: TiProvider[] = [];
  if (names.has("abuseipdb")) {
    const { createAbuseIpDbProvider } = await import("./abuseipdb");
    providers.push(createAbuseIpDbProvider({ apiKey: config.abuseipdbKey ?? undefined }));
  }
  if (names.has("otx")) {
    const { createOtxProvider } = await import("./otx");
    providers.push(createOtxProvider({ apiKey: config.otxKey ?? undefined }));
  }
  return providers;
}

/** Cache store abstraction so the aggregator stays DB-agnostic and unit-testable. */
export interface TiCacheStore {
  get(indicator: string, type: IocType): Promise<TiVerdict | null>;
  set(verdict: TiVerdict): Promise<void>;
}

export class InMemoryTiCache implements TiCacheStore {
  private map = new Map<string, TiVerdict>();

  async get(indicator: string, type: IocType): Promise<TiVerdict | null> {
    return this.map.get(`${indicator}:${type}`) ?? null;
  }

  async set(verdict: TiVerdict): Promise<void> {
    this.map.set(`${verdict.indicator}:${verdict.type}`, verdict);
  }

  clear(): void {
    this.map.clear();
  }
}

/** Global in-memory cache for IP indicator reputation lookups across requests. */
export const globalTiCache = new InMemoryTiCache();

/** Merge per-provider verdicts into one — max score, sum pulses, union sources. */
export function mergeVerdicts(
  verdicts: TiVerdict[],
  indicator: string,
  type: IocType,
): TiVerdict {
  const scores = verdicts.map((v) => v.abuseScore).filter((s): s is number => s !== null);
  const pulses = verdicts.map((v) => v.pulseCount).filter((p): p is number => p !== null);
  const categories = [
    ...new Set(verdicts.map((v) => v.abuseCategory).filter((c): c is string => c !== null)),
  ];
  const sources = [...new Set(verdicts.flatMap((v) => v.sources))];
  return {
    indicator,
    type,
    abuseScore: scores.length ? Math.max(...scores) : null,
    abuseCategory: categories.length ? categories.join(",") : null,
    pulseCount: pulses.length ? pulses.reduce((a, b) => a + b, 0) : null,
    sources,
  };
}

/**
 * Fan-out across providers, swallowing per-provider failures (Promise.allSettled).
 * Returns null only if every provider fails or reports nothing.
 */
export async function aggregateLookup(
  ctx: TiLookupContext,
  providers: TiProvider[],
  fetchFn: typeof fetch = fetch,
): Promise<TiVerdict | null> {
  const settled = await Promise.allSettled(providers.map((p) => p.lookup(ctx, fetchFn)));
  const ok = settled
    .filter(
      (r): r is PromiseFulfilledResult<TiVerdict | null> => r.status === "fulfilled",
    )
    .map((r) => r.value)
    .filter((v): v is TiVerdict => v !== null);
  if (ok.length === 0) return null;
  return mergeVerdicts(ok, ctx.indicator, ctx.type);
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Cached IP lookup: checks the store first (local, unlimited), else fans out
 * to providers and caches the merged verdict. ponytail: IPv6 + hash/domain.
 */
export async function lookupIp(
  ip: string,
  providers: TiProvider[],
  options: { cache?: TiCacheStore; fetchFn?: typeof fetch } = {},
): Promise<TiVerdict | null> {
  if (!IPV4_RE.test(ip)) return null;
  const ctx: TiLookupContext = { indicator: ip, type: "ip" };

  if (options.cache) {
    const hit = await options.cache.get(ip, "ip");
    if (hit) return hit;
  }

  const verdict = await aggregateLookup(ctx, providers, options.fetchFn ?? fetch);
  if (verdict && options.cache) {
    await options.cache.set(verdict);
  }
  return verdict;
}
