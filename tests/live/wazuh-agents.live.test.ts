import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config";
import { createWazuhClient } from "../../src/server/wazuh/adapter";

const live = process.env.LIVE_WAZUH_ACCEPTANCE === "1" ? it : it.skip;

describe("Live Wazuh Agents acceptance test", () => {
  live("authenticates and fetches real Wazuh agents", async () => {
    const agents = await createWazuhClient(loadConfig(process.env).wazuh).listAgents();
    expect(agents.length).toBeGreaterThan(0);
  });
});
