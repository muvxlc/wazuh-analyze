import { describe, expect, it, vi } from "vitest";
import {
  InMemoryTiCache,
  aggregateLookup,
  lookupIp,
  lookupIoc,
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
    const otx = createOtxProvider({ apiKey: "key" });
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

  describe("lookupIoc", () => {
    it("delegates to providers for domain indicators", async () => {
      const mock = {
        name: "mock",
        lookup: async (ctx: { indicator: string; type: string }) =>
          ctx.type === "domain"
            ? { indicator: ctx.indicator, type: "domain" as const, abuseScore: 60, abuseCategory: "phishing", pulseCount: 2, sources: ["mock"] }
            : null,
      };
      const result = await lookupIoc("evil.com", "domain", [mock], { cache: new InMemoryTiCache() });
      expect(result).toEqual(
        expect.objectContaining({ indicator: "evil.com", type: "domain", abuseScore: 60 }),
      );
    });

    it("delegates to providers for hash indicators", async () => {
      const mock = {
        name: "mock",
        lookup: async (ctx: { indicator: string; type: string }) =>
          ctx.type === "hash"
            ? { indicator: ctx.indicator, type: "hash" as const, abuseScore: 90, abuseCategory: "malware", pulseCount: 5, sources: ["mock"] }
            : null,
      };
      const result = await lookupIoc("d41d8cd98f00b204e9800998ecf8427e", "hash", [mock], { cache: new InMemoryTiCache() });
      expect(result).toEqual(
        expect.objectContaining({ indicator: "d41d8cd98f00b204e9800998ecf8427e", type: "hash", abuseScore: 90 }),
      );
    });

    it("uses cache for domain/hash", async () => {
      const cache = new InMemoryTiCache();
      await cache.set({ indicator: "bad.com", type: "domain", abuseScore: 40, abuseCategory: "spam", pulseCount: null, sources: ["cached"] });
      const called = vi.fn().mockResolvedValue(null);
      const result = await lookupIoc("bad.com", "domain", [{ name: "mock", lookup: called }], { cache });
      expect(result).toEqual(expect.objectContaining({ abuseScore: 40 }));
      expect(called).not.toHaveBeenCalled();
    });
  });

  describe("OTX domain/hash support", () => {
    it("returns null without API key for any type", async () => {
      const otx = createOtxProvider();
      expect(await otx.lookup({ indicator: "evil.com", type: "domain" })).toBeNull();
      expect(await otx.lookup({ indicator: "abc123", type: "hash" })).toBeNull();
    });

    it("looks up domain with correct URL and returns verdict", async () => {
      const otx = createOtxProvider({ apiKey: "key" });
      const fetchMock = vi.fn().mockResolvedValueOnce(
        Response.json({ pulse_info: { count: 7 }, reputation: { reputation: "malicious" } }),
      );
      const res = await otx.lookup({ indicator: "evil.com", type: "domain" }, fetchMock as unknown as typeof fetch);
      expect(res).toEqual({
        indicator: "evil.com",
        type: "domain",
        abuseScore: 7,
        abuseCategory: "malicious",
        pulseCount: 7,
        sources: ["otx"],
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/indicators/domain/");
    });

    it("looks up hash with correct URL and returns verdict", async () => {
      const otx = createOtxProvider({ apiKey: "key" });
      const fetchMock = vi.fn().mockResolvedValueOnce(
        Response.json({ pulse_info: { count: 12 }, reputation: { reputation: "malware" } }),
      );
      const res = await otx.lookup({ indicator: "d41d8cd98f00b204e9800998ecf8427e", type: "hash" }, fetchMock as unknown as typeof fetch);
      expect(res?.type).toBe("hash");
      expect(res?.pulseCount).toBe(12);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/indicators/fileSHA256/");
    });

    it("returns null on 404 for unknown indicator", async () => {
      const otx = createOtxProvider({ apiKey: "key" });
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response("not found", { status: 404 }));
      expect(await otx.lookup({ indicator: "unknown.example", type: "domain" }, fetchMock as unknown as typeof fetch)).toBeNull();
    });
  });
});
