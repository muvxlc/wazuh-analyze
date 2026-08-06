import { describe, expect, it, vi } from "vitest";
import { createWazuhClient } from "./adapter";
import { WazuhError } from "./errors";
import type { WazuhConfig } from "./types";

describe("Wazuh adapter", () => {
  const baseConfig: WazuhConfig = {
    apiUrl: new URL("https://wazuh.local"),
    username: "wazuh-user",
    password: "secret-password",
    caPath: null,
    allowInsecureTls: false,
  };

  it("maps Wazuh affected_items", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("token_value", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            affected_items: [
              { id: "001", name: "agent-1", status: "active", ip: "10.0.0.1", version: "Wazuh v4.7.2", lastKeepAlive: "2026-08-04T10:00:00Z", group: ["core-servers", "security"] },
            ],
          },
        })
      );

    const client = createWazuhClient(baseConfig, fetchMock);
    const agents = await client.listAgents();

    expect(agents).toEqual([
      expect.objectContaining({ id: "001", name: "agent-1", status: "active", ip: "10.0.0.1", version: "Wazuh v4.7.2", groups: ["core-servers", "security"] }),
    ]);
  });
});
