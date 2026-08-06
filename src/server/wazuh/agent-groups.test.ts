import { describe, expect, it } from "vitest";
import {
  indexAgentGroups,
  resolveAgentIdsForGroups,
  mergeAgentGroups,
} from "./agent-groups";
import type { WazuhAgent } from "./types";

describe("agent-groups", () => {
  const agentA: WazuhAgent = {
    id: "001", name: "host-a", status: "active", ip: "10.0.0.1", version: "4.7",
    lastKeepAlive: "2026-08-04T10:00:00Z", groups: ["core-servers", "security"],
  };
  const agentB: WazuhAgent = {
    id: "002", name: "host-b", status: "active", ip: "10.0.0.2", version: "4.7",
    lastKeepAlive: null, groups: ["dmz"],
  };
  const agentC: WazuhAgent = {
    id: "003", name: "host-c", status: "disconnected", ip: "", version: "",
    lastKeepAlive: null, groups: [],
  };

  it("indexes agents and extracts distinct sorted groups", () => {
    const index = indexAgentGroups([agentA, agentB, agentC]);
    expect(index.groups).toEqual(["core-servers", "dmz", "security"]);
    expect(index.byAgentId.get("001")).toEqual(["core-servers", "security"]);
    expect(index.byAgentId.get("002")).toEqual(["dmz"]);
    expect(index.byAgentId.get("003")).toEqual([]);
    expect(index.byAgentId.has("missing")).toBe(false);
  });

  it("returns undefined for empty groups filter", () => {
    const index = indexAgentGroups([agentA]);
    expect(resolveAgentIdsForGroups(index, undefined)).toBeUndefined();
    expect(resolveAgentIdsForGroups(index, [])).toBeUndefined();
  });

  it("resolves agent ids matching any requested group", () => {
    const index = indexAgentGroups([agentA, agentB, agentC]);
    expect(resolveAgentIdsForGroups(index, ["core-servers"])).toEqual(["001"]);
    expect(resolveAgentIdsForGroups(index, ["dmz", "security"])).toEqual(["001", "002"]);
    expect(resolveAgentIdsForGroups(index, ["nonexistent"])).toEqual([]);
  });

  it("does not mutate input items when no live agents", () => {
    const items = [{ agentId: "001", groups: ["stored"] }];
    const index = indexAgentGroups([]);
    expect(mergeAgentGroups(items, index)).toEqual([{ agentId: "001", groups: ["stored"] }]);
  });

  it("fills empty stored groups from live agent groups", () => {
    const items = [
      { agentId: "001", groups: [] as string[] },
      { agentId: "002", groups: ["stored"] },
      { agentId: null, groups: [] },
    ];
    const index = indexAgentGroups([agentA, agentB]);
    const result = mergeAgentGroups(items, index);
    expect(result[0].groups).toEqual(["core-servers", "security"]);
    expect(result[1].groups).toEqual(["stored"]); // preserved
    expect(result[2].groups).toEqual([]); // no agent id
  });

  it("handles missing agent id in index", () => {
    const items = [{ agentId: "999", groups: [] }];
    const index = indexAgentGroups([agentA]);
    const result = mergeAgentGroups(items, index);
    expect(result[0].groups).toEqual([]); // agent 999 not in index
  });
});
