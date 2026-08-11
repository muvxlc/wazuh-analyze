import { describe, expect, it, vi } from "vitest";
import { createAbuseIpDbProvider, refreshAbuseIpDbBlacklist } from "./abuseipdb";
import { InMemoryTiCache } from "./provider";

describe("AbuseIPDB edge cases", () => {
  it("returns 0 when blacklist response is not OK", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    await expect(
      refreshAbuseIpDbBlacklist("secret", new InMemoryTiCache(), {
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toBe(0);
  });

  it.each([
    ["non-array body.data", { data: { ipAddress: "1.1.1.1" } }],
    ["empty blacklist", { data: [] }],
  ])("returns 0 for %s", async (_case, body) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(body));

    await expect(
      refreshAbuseIpDbBlacklist("secret", new InMemoryTiCache(), {
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toBe(0);
  });

  it("skips rows without an IP address and counts valid rows", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: [
          { ipAddress: "1.1.1.1", abuseConfidenceScore: 80 },
          { ipAddress: "", abuseConfidenceScore: 90 },
        ],
      }),
    );
    const cache = new InMemoryTiCache();

    await expect(
      refreshAbuseIpDbBlacklist("secret", cache, {
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toBe(1);
    expect(await cache.get("1.1.1.1", "ip")).toEqual(
      expect.objectContaining({ abuseScore: 80 }),
    );
  });

  it("defaults missing blacklist confidence score to 100", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ data: [{ ipAddress: "1.1.1.1" }] }),
    );
    const cache = new InMemoryTiCache();

    await refreshAbuseIpDbBlacklist("secret", cache, {
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(await cache.get("1.1.1.1", "ip")).toEqual(
      expect.objectContaining({ abuseScore: 100 }),
    );
  });

  it("returns null when lookup confidence score is not numeric", async () => {
    const provider = createAbuseIpDbProvider({ apiKey: "secret" });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ data: { abuseConfidenceScore: "95" } }),
    );

    await expect(
      provider.lookup({ indicator: "8.8.8.8", type: "ip" }, fetchMock as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("uses default max age and includes IP address in lookup URL", async () => {
    const provider = createAbuseIpDbProvider({ apiKey: "secret" });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ data: { abuseConfidenceScore: 10 } }),
    );

    await provider.lookup({ indicator: "8.8.8.8", type: "ip" }, fetchMock as unknown as typeof fetch);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("ipAddress=8.8.8.8");
    expect(url).toContain("maxAgeInDays=90");
  });
});
