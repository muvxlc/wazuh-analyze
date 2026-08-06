import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache, wazuhGet } from "./http-client";
import { WazuhError } from "./errors";
import type { WazuhConfig } from "./types";

describe("wazuhGet", () => {
  const config: WazuhConfig = {
    apiUrl: new URL("https://wazuh.local"),
    username: "user",
    password: "pass",
    caPath: null,
    allowInsecureTls: false,
  };

  afterEach(() => {
    clearTokenCache();
  });

  it("authenticates and fetches data with query params", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("token_v1", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({ data: { affected_items: [{ name: "test-package" }] } }),
      );

    const res = await wazuhGet(config, "/syscollector/001/packages", {
      query: { limit: 5, search: "nginx" },
      fetchFn: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://wazuh.local/syscollector/001/packages?limit=5&search=nginx",
    );
    expect(res).toEqual({ data: { affected_items: [{ name: "test-package" }] } });
  });

  it("throws WazuhError and clears cache on 401", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("token_expired", { status: 200 }))
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("token_new", { status: 200 }))
      .mockResolvedValueOnce(Response.json({ data: { ok: true } }));

    await expect(
      wazuhGet(config, "/agents", { fetchFn: fetchMock }),
    ).rejects.toThrow(WazuhError);

    // Next call should re-authenticate due to cleared cache on 401
    await wazuhGet(config, "/agents", { fetchFn: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
