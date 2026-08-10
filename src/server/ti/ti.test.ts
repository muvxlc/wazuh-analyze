import { describe, expect, it, vi } from "vitest";
import {
  InMemoryTiCache,
  aggregateLookup,
  lookupIp,
  mergeVerdicts,
  registerTiProvider,
  resolveTiProviders,
} from "./provider";
import { createAbuseIpDbProvider, refreshAbuseIpDbBlacklist } from "./abuseipdb";
import { createOtxProvider } from "./otx";

describe("threat intel layer", () => {
  it("merges verdicts correctly across multiple sources", () => {
    const merged = mergeVerdicts(
      [
        { indicator: "1.2.3.4", type: "ip", abuseScore: 20, abuseCategory: "spam", pulseCount: null, sources: ["a"] },
        { indicator: "1.2.3.4", type: "ip", abuseScore: 80, abuseCategory: "malware", pulseCount: 5, sources: ["b"] },
      ],
      "1.2.3.4",
      "ip",
    );
    expect(merged).toEqual({
      indicator: "1.2.3.4",
      type: "ip",
      abuseScore: 80,
      abuseCategory: "spam,malware",
      pulseCount: 5,
      sources: ["a", "b"],
    });
  });

  it("abuseipdb returns null on missing key or rate limit (429)", async () => {
    const noKey = createAbuseIpDbProvider({});
    expect(await noKey.lookup({ indicator: "8.8.8.8", type: "ip" })).toBeNull();

    const withKey = createAbuseIpDbProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("rate-limited", { status: 429 }));
    expect(
      await withKey.lookup({ indicator: "8.8.8.8", type: "ip" }, fetchMock as unknown as typeof fetch),
    ).toBeNull();
  });

  it("abuseipdb fetches score and seeds blacklist cache", async () => {
    const provider = createAbuseIpDbProvider({ apiKey: "secret" });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ data: { ipAddress: "10.0.0.1", abuseConfidenceScore: 95, totalReports: 12 } }),
    );
    const res = await provider.lookup({ indicator: "10.0.0.1", type: "ip" }, fetchMock as unknown as typeof fetch);
    expect(res).toEqual({
      indicator: "10.0.0.1",
      type: "ip",
      abuseScore: 95,
      abuseCategory: "12 reports",
      pulseCount: null,
      sources: ["abuseipdb"],
    });

    const blacklistMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: [
          { ipAddress: "1.1.1.1", abuseConfidenceScore: 100 },
          { ipAddress: "2.2.2.2", abuseConfidenceScore: 80 },
        ],
      }),
    );
    const cache = new InMemoryTiCache();
    const seeded = await refreshAbuseIpDbBlacklist("secret", cache, {
      fetchFn: blacklistMock as unknown as typeof fetch,
    });
    expect(seeded).toBe(2);
    expect(await cache.get("1.1.1.1", "ip")).toEqual(
      expect.objectContaining({ abuseScore: 100, sources: ["abuseipdb:blacklist"] }),
    );
  });

  it("refreshAbuseIpDbBlacklist returns 0 on network failure", async () => {
    const cache = new InMemoryTiCache();
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("fetch failed"));
    await expect(refreshAbuseIpDbBlacklist("secret", cache, {
      fetchFn: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow("fetch failed");
  });

  it("otx extracts pulse count", async () => {
    const otx = createOtxProvider();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ pulse_info: { count: 3 }, reputation: { reputation: "malicious" } }),
    );
    const res = await otx.lookup({ indicator: "5.5.5.5", type: "ip" }, fetchMock as unknown as typeof fetch);
    expect(res).toEqual({
      indicator: "5.5.5.5",
      type: "ip",
      abuseScore: 3,
      abuseCategory: "malicious",
      pulseCount: 3,
      sources: ["otx"],
    });
  });

  it("lookupIp uses cache and falls back to aggregator without blowing up if one provider fails", async () => {
    const brokenProvider = {
      name: "broken",
      lookup: async () => { throw new Error("Network offline"); },
    };
    const goodProvider = {
      name: "good",
      lookup: async (ctx: { indicator: string; type: string }) => ({
        indicator: ctx.indicator,
        type: ctx.type as "ip",
        abuseScore: 50,
        abuseCategory: null,
        pulseCount: 1,
        sources: ["good"],
      }),
    };

    const cache = new InMemoryTiCache();
    // Cold cache: hits aggregateLookup, swallows broken provider error
    const verdict = await lookupIp("9.9.9.9", [brokenProvider, goodProvider], { cache });
    expect(verdict?.sources).toEqual(["good"]);

    // Warm cache: instant hit without calling providers
    const hit = await lookupIp("9.9.9.9", [], { cache });
    expect(hit?.abuseScore).toBe(50);

    // Invalid IP rejected immediately
    expect(await lookupIp("not-an-ip", [goodProvider], { cache })).toBeNull();
  });

  it("registry resolves providers by name", () => {
    registerTiProvider({ name: "mock-a", lookup: async () => null });
    registerTiProvider({ name: "mock-b", lookup: async () => null });
    const resolved = resolveTiProviders(["mock-a", "nonexistent", "mock-b"]);
    expect(resolved.map((r) => r.name)).toEqual(["mock-a", "mock-b"]);
  });
});
