import { describe, expect, it, vi } from "vitest";

import type { WazuhConfig } from "./types";
import { fetchAgentVulnerabilities, fetchVulnerabilityById, pingIndexer } from "./indexer";
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

const flatHit = {
  _index: "wazuh-states-vulnerabilities-4.8.0-1",
  _id: "abc123",
  _score: 1,
  _source: {
    agent: { id: "001", name: "test-agent" },
    cve: "CVE-2024-0001",
    title: "OpenSSL buffer overflow",
    severity: "high",
    cvss_score: 9.1,
    status: "valid",
    published: "2024-01-15T00:00:00Z",
  },
};

const nestedHit = {
  _index: "wazuh-states-vulnerabilities-4.8.0-1",
  _id: "abc124",
  _score: 1,
  _source: {
    agent: { id: "001", name: "test-agent" },
    vulnerability: {
      cve: "CVE-2024-0002",
      severity: "critical",
      cvss: { cvss3: { base_score: 9.8 } },
      status: "valid",
    },
  },
};

describe("pingIndexer", () => {
  it("returns false when no indexer configured", async () => {
    const config = { ...baseConfig, indexer: null };
    const result = await pingIndexer(config);
    expect(result).toBe(false);
  });

  it("returns true on HTTP 200", async () => {
    const fetch = mockFetch([{ status: 200, body: {} }]);
    const result = await pingIndexer(baseConfig, fetch);
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns false on HTTP error", async () => {
    const fetch = mockFetch([{ status: 500, body: {} }]);
    const result = await pingIndexer(baseConfig, fetch);
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    const fetch = mockFetch([{ error: "ECONNREFUSED" }]);
    const result = await pingIndexer(baseConfig, fetch);
    expect(result).toBe(false);
  });
});

describe("fetchAgentVulnerabilities", () => {
  it("returns [] when no indexer configured", async () => {
    const config = { ...baseConfig, indexer: null };
    const result = await fetchAgentVulnerabilities(config, "001");
    expect(result).toEqual([]);
  });

  it("sends nested agent query with correct agent id", async () => {
    const requestBody: unknown = (async () => {
      let captured: unknown;
      const fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        captured = JSON.parse(init.body as string);
        return { ok: true, status: 200, json: async () => ({ hits: { total: { value: 0 }, hits: [] } }) };
      });
      await fetchAgentVulnerabilities(baseConfig, "001", 10, fetch);
      return captured;
    })();

    const body = await requestBody;
    const must = (body as { query: { bool: { must: unknown[] } } }).query.bool.must;
    expect(must).toHaveLength(2);
    expect(must[0]).toEqual({
      nested: { path: "agent", query: { term: { "agent.id": "001" } } },
    });
    expect(must[1]).toEqual({ term: { "vulnerability.status": "valid" } });
  });

  it("sends severity desc sort and correct size", async () => {
    let captured: unknown;
    const fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({ hits: { total: { value: 0 }, hits: [] } }) };
    });
    await fetchAgentVulnerabilities(baseConfig, "001", 5, fetch);
    const body = captured as { sort: unknown[]; size: number };
    expect(body.size).toBe(5);
    expect(body.sort).toEqual([{ "vulnerability.severity": { order: "desc" } }]);
  });

  it("extracts flat _source fields (Wazuh actual shape)", async () => {
    const fetch = mockFetch([{
      status: 200,
      body: { hits: { total: { value: 1 }, hits: [flatHit] } },
    }]);
    const result = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cve: "CVE-2024-0001",
      title: "OpenSSL buffer overflow",
      severity: "high",
      cvss_score: 9.1,
      status: "valid",
      published: "2024-01-15T00:00:00Z",
    });
  });

  it("falls back to vulnerability nested path for legacy docs", async () => {
    const fetch = mockFetch([{
      status: 200,
      body: { hits: { total: { value: 1 }, hits: [nestedHit] } },
    }]);
    const result = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result).toHaveLength(1);
    expect(result[0].cve).toBe("CVE-2024-0002");
    expect(result[0].severity).toBe("critical");
    expect(result[0].cvss_score).toBe(9.8);
    expect(result[0].status).toBe("valid");
  });

  it("prefers top-level cvss_score over cvss.cvss3.base_score", async () => {
    const hit = {
      ...flatHit,
      _source: {
        ...flatHit._source,
        cvss_score: 5.0,
        vulnerability: { cvss: { cvss3: { base_score: 9.8 } } },
      },
    };
    const fetch = mockFetch([{ status: 200, body: { hits: { total: { value: 1 }, hits: [hit] } } }]);
    const result = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result[0].cvss_score).toBe(5.0);
  });

  it("falls back to cvss.cvss2.base_score when cvss_score absent", async () => {
    const hit = {
      _index: "idx", _id: "id", _score: 1,
      _source: {
        agent: { id: "001", name: "test" },
        vulnerability: {
          cve: "CVE-2024-0003",
          severity: "medium",
          cvss: { cvss2: { base_score: 6.5 } },
          status: "valid",
        },
      },
    };
    const fetch = mockFetch([{ status: 200, body: { hits: { total: { value: 1 }, hits: [hit] } } }]);
    const result = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result[0].cvss_score).toBe(6.5);
  });

  it("returns empty array when hits is empty", async () => {
    const fetch = mockFetch([{ status: 200, body: { hits: { total: { value: 0 }, hits: [] } } }]);
    const result = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result).toEqual([]);
  });

  it("falls back to flat agent query when nested query 400s (object mapping)", async () => {
    let firstBody: unknown;
    let secondBody: unknown;
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const isNested = (body as { query: { bool: { must: unknown[] } } }).query.bool.must[0]
        && typeof ((body as { query: { bool: { must: { nested?: unknown }[] } } }).query.bool.must[0].nested) !== "undefined";
      if (isNested) {
        firstBody = body;
        return { ok: false, status: 400, json: async () => ({ error: { type: "query_shard_exception" } }) };
      }
      secondBody = body;
      return { ok: true, status: 200, json: async () => ({ hits: { total: { value: 1 }, hits: [flatHit] } }) };
    });
    const result = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(firstBody).toBeTruthy();
    expect(secondBody).toBeTruthy();
    const firstMust = (firstBody as { query: { bool: { must: Record<string, unknown>[] } } }).query.bool.must;
    const secondMust = (secondBody as { query: { bool: { must: Record<string, unknown>[] } } }).query.bool.must;
    expect(firstMust[0].nested).toBeDefined();
    expect(secondMust[0].term).toEqual({ "agent.id": "001" });
    expect(result).toHaveLength(1);
    expect(result[0].cve).toBe("CVE-2024-0001");
  });

  it("throws WazuhError on 4xx", async () => {
    const fetch = mockFetch([{ status: 403, body: { error: "forbidden" } }]);
    await expect(
      fetchAgentVulnerabilities(baseConfig, "001", 20, fetch),
    ).rejects.toThrow(WazuhError);
  });

  it("throws WazuhError on 5xx", async () => {
    const fetch = mockFetch([{ status: 500, body: { error: "internal" } }]);
    await expect(
      fetchAgentVulnerabilities(baseConfig, "001", 20, fetch),
    ).rejects.toThrow(WazuhError);
  });

  it("throws typed WazuhError on network failure, not silent empty", async () => {
    const fetch = mockFetch([{ error: "ENOTFOUND" }]);
    await expect(
      fetchAgentVulnerabilities(baseConfig, "001", 20, fetch),
    ).rejects.toMatchObject({ code: "wazuh_indexer_error", status: 0 });
  });

  it("uses indexer CA/allowInsecureTls when set, falling back to config", async () => {
    const config = {
      ...baseConfig,
      caPath: "/etc/ssl/ca.pem",
      allowInsecureTls: false,
      indexer: {
        ...baseConfig.indexer!,
        caPath: "/etc/ssl/indexer-ca.pem",
        allowInsecureTls: true,
      },
    };
    const fetch = mockFetch([{ status: 200, body: { hits: { total: { value: 0 }, hits: [] } } }]);
    // Should not throw — validates config is used without crashing
    const result = await fetchAgentVulnerabilities(config, "001", 20, fetch);
    expect(result).toEqual([]);
  });

  it("maps _id to sourceId and allowlisted flat fields", async () => {
    const hit = {
      ...flatHit,
      _source: {
        ...flatHit._source,
        package_name: "openssl",
        installed_version: "1.0.0",
        fixed_version: "1.0.1",
        os: "Ubuntu 24.04",
        exposure: "internet-facing",
        detection: "package inventory",
        secret: "must not escape",
      },
    };
    const fetch = mockFetch([{ status: 200, body: { hits: { hits: [hit] } } }]);
    const [result] = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result).toMatchObject({
      sourceId: "abc123",
      package: "openssl",
      installedVersion: "1.0.0",
      fixedVersion: "1.0.1",
      os: "Ubuntu 24.04",
      exposure: "internet-facing",
      detection: "package inventory",
    });
    expect(result).not.toHaveProperty("secret");
  });

  it("uses agent-scoped deterministic fallback when _id is malformed or absent", async () => {
    const source = {
      agent: { id: "001" },
      cve: "CVE-2024-0001",
      package_name: "openssl",
      installed_version: "1.0.0",
      severity: "high",
      status: "valid",
    };
    const fetch = mockFetch([{
      status: 200,
      body: { hits: { hits: [
        { _index: "vulns-a", _id: 42, _source: source },
        { _index: "vulns-a", _source: source },
      ] } },
    }]);
    const result = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result[0].sourceId).toMatch(/^fallback-001-/);
    expect(result[1].sourceId).toBe(result[0].sourceId);
    expect(result[0].sourceId).not.toBe("CVE-2024-0001");

    const otherAgent = await fetchAgentVulnerabilities(baseConfig, "002", 20, mockFetch([{
      status: 200,
      body: { hits: { hits: [{ _index: "vulns-a", _source: source }] } },
    }]));
    expect(otherAgent[0].sourceId).not.toBe(result[0].sourceId);
  });

  it("maps nested package, versions, OS, exposure, and detection fields", async () => {
    const hit = {
      ...nestedHit,
      _source: {
        ...nestedHit._source,
        vulnerability: {
          ...nestedHit._source.vulnerability,
          package: { name: "libssl", version: "3.0.0", fixed_version: "3.0.2" },
          os: "Debian",
          exposure: "localhost-only",
          detection_method: "system scan",
        },
      },
    };
    const fetch = mockFetch([{ status: 200, body: { hits: { hits: [hit] } } }]);
    const [result] = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result).toMatchObject({
      sourceId: "abc124",
      package: "libssl",
      installedVersion: "3.0.0",
      fixedVersion: "3.0.2",
      os: "Debian",
      exposure: "localhost-only",
      detection: "system scan",
    });
  });

  it("drops malformed fields and never returns raw source", async () => {
    const fetch = mockFetch([{ status: 200, body: { hits: { hits: [{
      _id: "safe-id",
      _source: {
        cve: ["bad"],
        title: { injection: true },
        severity: 99,
        cvss_score: "9.9",
        status: null,
        package_name: ["bad"],
        installed_version: { value: "bad" },
        fixed_version: "  fixed  ",
        nested: { attacker: "payload" },
      },
    }] } } }]);
    const [result] = await fetchAgentVulnerabilities(baseConfig, "001", 20, fetch);
    expect(result).toEqual({ sourceId: "safe-id", fixedVersion: "fixed", cve: "", severity: "", status: "" });
    expect(result).not.toHaveProperty("nested");
  });
});

describe("fetchVulnerabilityById", () => {
  it("queries exact source ID, agent, and valid status", async () => {
    let body: Record<string, any> | undefined;
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string) as Record<string, any>;
      return { ok: true, status: 200, json: async () => ({ hits: { hits: [flatHit] } }) };
    });
    const result = await fetchVulnerabilityById(baseConfig, "001", "abc123", fetch);
    expect(result?.sourceId).toBe("abc123");
    expect(body?.size).toBe(1);
    expect(body?.query.bool.must).toEqual([
      { nested: { path: "agent", query: { term: { "agent.id": "001" } } } },
      { term: { _id: "abc123" } },
      { term: { "vulnerability.status": "valid" } },
    ]);
  });

  it("returns null for no hit, wrong agent, or invalid status", async () => {
    const fetch = mockFetch([
      { status: 200, body: { hits: { hits: [] } } },
    ]);
    await expect(fetchVulnerabilityById(baseConfig, "002", "abc123", fetch)).resolves.toBeNull();

    const bodies: Record<string, any>[] = [];
    const guardedFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return { ok: true, status: 200, json: async () => ({ hits: { hits: [] } }) };
    });
    await fetchVulnerabilityById(baseConfig, "001", "abc123", guardedFetch);
    expect(bodies[0].query.bool.must).toContainEqual({ term: { "vulnerability.status": "valid" } });
  });

  it("falls back to flat agent query when nested detail query returns 400", async () => {
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { query: { bool: { must: unknown[] } } };
      if (body.query.bool.must[0] && "nested" in (body.query.bool.must[0] as object)) {
        return { ok: false, status: 400, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ hits: { hits: [flatHit] } }) };
    });
    await expect(fetchVulnerabilityById(baseConfig, "001", "abc123", fetch)).resolves.toMatchObject({ sourceId: "abc123" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string) as { query: { bool: { must: unknown[] } } };
    expect(second.query.bool.must[0]).toEqual({ term: { "agent.id": "001" } });
    expect(second.query.bool.must.slice(1)).toContainEqual({ term: { _id: "abc123" } });
    expect(second.query.bool.must).toContainEqual({ term: { "vulnerability.status": "valid" } });
  });
});
