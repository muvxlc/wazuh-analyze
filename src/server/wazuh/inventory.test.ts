import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache } from "./http-client";
import {
  clearInventoryCache,
  fetchAgentHealth,
  fetchAgentSca,
  fetchMitreTechnique,
  fetchProcesses,
} from "./inventory";
import { WazuhError } from "./errors";
import type { WazuhConfig } from "./types";

const baseConfig: WazuhConfig = {
  apiUrl: new URL("https://wazuh.local"),
  username: "user",
  password: "pass",
  caPath: null,
  allowInsecureTls: false,
};

function mockAuth() {
  return vi.fn().mockResolvedValueOnce(new Response("tok", { status: 200 }));
}

describe("wazuh inventory", () => {
  beforeEach(() => {
    clearInventoryCache();
    clearTokenCache();
  });
  afterEach(() => {
    clearInventoryCache();
    clearTokenCache();
  });

  it("fetches SCA with correct URL and query", async () => {
    const fetchMock = mockAuth().mockResolvedValueOnce(
      Response.json({ data: { affected_items: [{ policy: "cis" }] } }),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    const res = await fetchAgentSca(baseConfig, "001", { fetchFn });
    expect(res).toEqual({ data: { affected_items: [{ policy: "cis" }] } });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://wazuh.local/sca/001?limit=20",
    );
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe("Bearer tok");
  });

  it("returns null on 404 (absent facet)", async () => {
    const fetchMock = mockAuth().mockResolvedValueOnce(
      new Response("Not found", { status: 404 }),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    const res = await fetchProcesses(baseConfig, "002", { fetchFn });
    expect(res).toBeNull();
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://wazuh.local/syscollector/002/processes?limit=30",
    );
  });

  it("serves subsequent calls from cache", async () => {
    const fetchMock = mockAuth().mockResolvedValueOnce(
      Response.json({ data: { affected_items: [] } }),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    await fetchProcesses(baseConfig, "001", { fetchFn });
    await fetchProcesses(baseConfig, "001", { fetchFn });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates non-404 errors", async () => {
    const fetchMock = mockAuth().mockResolvedValueOnce(
      new Response("Boom", { status: 500 }),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    await expect(fetchAgentSca(baseConfig, "001", { fetchFn })).rejects.toBeInstanceOf(WazuhError);
  });

  it("rejects invalid agent IDs", async () => {
    await expect(fetchAgentSca(baseConfig, "001; rm -rf /")).rejects.toThrow(WazuhError);
  });

  it("matches MITRE technique client-side from list", async () => {
    const fetchMock = mockAuth().mockResolvedValueOnce(
      Response.json({
        data: {
          affected_items: [
            { id: "T1059", name: "Command and Scripting" },
            { id: "T1078", name: "Valid Accounts" },
          ],
        },
      }),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    const res = (await fetchMitreTechnique(baseConfig, "T1059", { fetchFn })) as {
      id: string;
      name: string;
    };
    expect(res).toEqual({ id: "T1059", name: "Command and Scripting" });
  });

  it("fetchAgentHealth aggregates manager + agent summaries", async () => {
    const fetchMock = mockAuth()
      .mockResolvedValueOnce(Response.json({ data: { status: "running" } }))
      .mockResolvedValueOnce(Response.json({ data: { connection: "active" } }));
    const fetchFn = fetchMock as unknown as typeof fetch;
    const res = (await fetchAgentHealth(baseConfig, { fetchFn })) as {
      manager: unknown;
      agents: unknown;
    };
    expect(res.manager).toEqual({ data: { status: "running" } });
    expect(res.agents).toEqual({ data: { connection: "active" } });
  });
});
