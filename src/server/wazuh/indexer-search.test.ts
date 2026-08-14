import { describe, expect, it, vi } from "vitest";

import type { WazuhConfig } from "./types";
import { parseSearchParams, searchIndexerEvents } from "./indexer-search";
import { WazuhError } from "./errors";

const mockFetch = (responses: Array<{ status: number; body: unknown } | { error: string }>) => {
  const queue = [...responses];
  return vi.fn().mockImplementation(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch call");
    if ("error" in next) throw new Error(next.error);
    return {
      ok: next.status < 400,
      status: next.status,
      json: async () => next.body,
    } as unknown as Response;
  });
};

const baseConfig: WazuhConfig = {
  apiUrl: new URL("https://wazuh.test:55000"),
  username: "u",
  password: "p",
  caPath: null,
  allowInsecureTls: false,
  indexer: {
    url: new URL("http://localhost:9200"),
    username: "u",
    password: "p",
    caPath: null,
    allowInsecureTls: false,
  },
};

describe("parseSearchParams", () => {
  it("returns empty params when no query", () => {
    expect(parseSearchParams(new URLSearchParams())).toEqual({});
  });

  it("accepts bounded agentId and ruleId", () => {
    const params = parseSearchParams(new URLSearchParams("agentId=001&ruleId=555"));
    expect(params).toEqual({ agentId: "001", ruleId: "555" });
  });

  it("accepts size within bounds", () => {
    expect(parseSearchParams(new URLSearchParams("size=10")).size).toBe(10);
    expect(parseSearchParams(new URLSearchParams("size=50")).size).toBe(50);
    expect(parseSearchParams(new URLSearchParams("size=1")).size).toBe(1);
  });

  it("clamps size to [1, 50]", () => {
    expect(parseSearchParams(new URLSearchParams("size=0")).size).toBe(1);
    expect(parseSearchParams(new URLSearchParams("size=-5")).size).toBe(1);
    expect(parseSearchParams(new URLSearchParams("size=999")).size).toBe(50);
    expect(parseSearchParams(new URLSearchParams("size=abc")).size).toBeUndefined();
  });

  it("drops oversized strings", () => {
    const long = "a".repeat(300);
    const params = parseSearchParams(new URLSearchParams(`agentId=${long}`));
    expect(params.agentId).toHaveLength(200);
  });

  it("parses valid ISO timestamps", () => {
    const params = parseSearchParams(new URLSearchParams("from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z"));
    expect(params.from).toBe("2024-01-01T00:00:00.000Z");
    expect(params.to).toBe("2024-01-02T00:00:00.000Z");
  });

  it("drops invalid date strings", () => {
    const params = parseSearchParams(new URLSearchParams("from=not-a-date&to=bogus"));
    expect(params.from).toBeUndefined();
    expect(params.to).toBeUndefined();
  });
});

describe("searchIndexerEvents", () => {
  it("returns empty when no indexer configured", async () => {
    const config = { ...baseConfig, indexer: null };
    const result = await searchIndexerEvents(config, {});
    expect(result).toEqual({ events: [], total: 0 });
  });

  it("builds minimal query body with match_all", async () => {
    let capturedBody: unknown;
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({ hits: { total: { value: 0 }, hits: [] } }) };
    });
    await searchIndexerEvents(baseConfig, {}, fetch as never);
    expect(capturedBody).toBeDefined();
    const body = capturedBody as { query: { bool: { must: unknown[] } }; size: number; _source: unknown[] };
    expect(body.query.bool.must).toEqual([{ match_all: {} }]);
    expect(body.size).toBe(20);
    expect(body._source).toContain("@timestamp");
  });

  it("adds agent.term and rule_id.term filters", async () => {
    let capturedBody: unknown;
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({ hits: { total: { value: 0 }, hits: [] } }) };
    });
    await searchIndexerEvents(baseConfig, { agentId: "001", ruleId: "555" }, fetch as never);
    const body = capturedBody as { query: { bool: { must: unknown[] } } };
    expect(body.query.bool.must).toEqual([
      { term: { "agent.id": "001" } },
      { term: { rule_id: "555" } },
    ]);
  });

  it("adds eventId term filter", async () => {
    let capturedBody: unknown;
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({ hits: { total: { value: 0 }, hits: [] } }) };
    });
    await searchIndexerEvents(baseConfig, { eventId: "evt-123" }, fetch as never);
    const body = capturedBody as { query: { bool: { must: unknown[] } } };
    expect(body.query.bool.must).toEqual([{ term: { _id: "evt-123" } }]);
  });

  it("adds timestamp range filter", async () => {
    let capturedBody: unknown;
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({ hits: { total: { value: 0 }, hits: [] } }) };
    });
    await searchIndexerEvents(baseConfig, {
      from: "2024-01-01T00:00:00Z",
      to: "2024-01-02T00:00:00Z",
    }, fetch as never);
    const body = capturedBody as { query: { bool: { must: unknown[] } } };
    expect(body.query.bool.must).toContainEqual({
      range: { "@timestamp": { gte: "2024-01-01T00:00:00.000Z", lte: "2024-01-02T00:00:00.000Z" } } },
    );
  });

  it("normalizes hits into RawEventRecord", async () => {
    const hit = {
      _index: "wazuh-alerts-4.x-2024.01.01",
      _id: "evt-abc",
      _score: 1,
      _source: {
        agent_id: "001",
        agent_name: "test-agent",
        rule_id: "555",
        level: 3,
        description: "SSH brute force",
        status: "triggered",
        "@timestamp": "2024-01-15T12:00:00Z",
        ingested_at: "2024-01-15T12:00:01Z",
        secret_field: "should-not-escape",
      },
    };
    const fetch = mockFetch([{
      status: 200,
      body: { hits: { total: { value: 1 }, hits: [hit] } },
    }]);
    const result = await searchIndexerEvents(baseConfig, { agentId: "001" }, fetch);
    expect(result.total).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "evt-abc",
      index: "wazuh-alerts-4.x-2024.01.01",
      agentId: "001",
      ruleId: "555",
      level: 3,
      description: "SSH brute force",
      status: "triggered",
      wazuhTimestamp: "2024-01-15T12:00:00Z",
    });
    expect(result.events[0]).not.toHaveProperty("secret_field");
  });

  it("throws WazuhError on network failure", async () => {
    const fetch = mockFetch([{ error: "ENOTFOUND" }]);
    await expect(searchIndexerEvents(baseConfig, {})).rejects.toThrow(WazuhError);
  });

  it("throws WazuhError on 4xx", async () => {
    const fetch = mockFetch([{ status: 403, body: { error: "forbidden" } }]);
    await expect(searchIndexerEvents(baseConfig, {})).rejects.toThrow(WazuhError);
  });

  it("throws WazuhError on 5xx", async () => {
    const fetch = mockFetch([{ status: 500, body: { error: "internal" } }]);
    await expect(searchIndexerEvents(baseConfig, {})).rejects.toThrow(WazuhError);
  });
});
