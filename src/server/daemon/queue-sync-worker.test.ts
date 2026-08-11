import { describe, expect, it, vi } from "vitest";
import { refreshAbuseIpDbBlacklist } from "../ti/abuseipdb";
import { InMemoryTiCache } from "../ti/provider";

describe("AbuseIPDB sync worker failure boundary", () => {
  it("refreshAbuseIpDbBlacklist rejects on DNS failure", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.abuseipdb.com"));
    const cache = new InMemoryTiCache();

    await expect(
      refreshAbuseIpDbBlacklist("k", cache, { fetchFn: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow("ENOTFOUND");
  });
});
