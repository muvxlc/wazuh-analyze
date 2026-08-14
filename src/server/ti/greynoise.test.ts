import { describe, expect, it, vi } from "vitest";
import { createGreyNoiseProvider } from "./greynoise";

describe("GreyNoise provider", () => {
  it("maps malicious classification to abuseScore 90 and posts key header", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        ip: "1.2.3.4",
        noise: true,
        riot: false,
        classification: "malicious",
        name: "Mirai",
        link: "https://viz.greynoise.io/riot/1.2.3.4",
        last_seen: "2024-01-01",
        message: "OK",
      }),
    );

    const verdict = await provider.lookup(
      { indicator: "1.2.3.4", type: "ip" },
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/v3/community/1.2.3.4");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.key).toBe("test-key");
    expect(headers.Accept).toBe("application/json");

    expect(verdict).not.toBeNull();
    expect(verdict?.abuseScore).toBe(90);
    expect(verdict?.sources).toEqual(["greynoise"]);
    expect(verdict?.type).toBe("ip");
    expect(verdict?.indicator).toBe("1.2.3.4");
    expect(verdict?.abuseCategory).toBe("Mirai · noise");
  });

  it("maps benign classification to abuseScore 0", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        ip: "8.8.8.8",
        noise: false,
        riot: true,
        classification: "benign",
        name: "Google Public DNS",
      }),
    );

    const verdict = await provider.lookup(
      { indicator: "8.8.8.8", type: "ip" },
      fetchMock as unknown as typeof fetch,
    );

    expect(verdict?.abuseScore).toBe(0);
    expect(verdict?.sources).toEqual(["greynoise"]);
  });

  it("maps unknown classification to null abuseScore (neutral)", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        ip: "5.6.7.8",
        noise: false,
        classification: "unknown",
        name: null,
      }),
    );

    const verdict = await provider.lookup(
      { indicator: "5.6.7.8", type: "ip" },
      fetchMock as unknown as typeof fetch,
    );

    expect(verdict?.abuseScore).toBeNull();
    expect(verdict?.abuseCategory).toBeNull();
  });

  it("returns null on 429 rate-limit (fail-open)", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 429 }));

    await expect(
      provider.lookup(
        { indicator: "1.2.3.4", type: "ip" },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
  });

  it("returns null on 403 forbidden (fail-open)", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 403 }));

    await expect(
      provider.lookup(
        { indicator: "1.2.3.4", type: "ip" },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
  });

  it("returns null on network failure (fail-open)", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("ENOTFOUND"));

    await expect(
      provider.lookup(
        { indicator: "1.2.3.4", type: "ip" },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
  });

  it("returns null on a non-JSON 2xx body (fail-open)", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("<html>error</html>", { status: 200 }),
    );

    await expect(
      provider.lookup(
        { indicator: "1.2.3.4", type: "ip" },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
  });

  it("returns null WITHOUT calling fetch when no apiKey configured", async () => {
    const provider = createGreyNoiseProvider({});
    const fetchMock = vi.fn();

    await expect(
      provider.lookup(
        { indicator: "1.2.3.4", type: "ip" },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for non-ip indicator type", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn();

    await expect(
      provider.lookup(
        { indicator: "abc123deadbeef", type: "hash" },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encodes the indicator in the URL path", async () => {
    const provider = createGreyNoiseProvider({ apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ ip: "10.0.0.1", classification: "benign" }),
    );

    await provider.lookup(
      { indicator: "10.0.0.1", type: "ip" },
      fetchMock as unknown as typeof fetch,
    );

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.greynoise.io/v3/community/10.0.0.1",
    );
  });
});
