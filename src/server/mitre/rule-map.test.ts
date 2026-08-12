import { describe, expect, it } from "vitest";
import { getRuleMitreTechniques, mergeMitreTechniques } from "./rule-map";

describe("MITRE rule mapping", () => {
  it("maps Wazuh netstat rule 533 deterministically", () => {
    expect(getRuleMitreTechniques("533")).toEqual([
      { techniqueId: "T1046", techniqueName: "Network Service Scanning", tactic: "Discovery" },
    ]);
  });

  it("prefers Wazuh-native rule.mitre metadata", () => {
    expect(getRuleMitreTechniques("533", {
      rule: { mitre: { id: ["T1110"], technique: ["Brute Force"], tactic: ["Credential Access"] } },
    })).toEqual([
      { techniqueId: "T1110", techniqueName: "Brute Force", tactic: "Credential Access" },
    ]);
  });

  it("keeps rule mapping when AI omits MITRE and deduplicates AI output", () => {
    const result = mergeMitreTechniques(
      getRuleMitreTechniques("533"),
      [
        { techniqueId: "t1046", techniqueName: "Network Service Scanning" },
        { techniqueId: "T1543.003", techniqueName: "Create or Modify System Process" },
      ],
    );
    expect(result?.map((item) => item.techniqueId)).toEqual(["T1046", "T1543.003"]);
  });

  it("does not invent mappings for unknown rules", () => {
    expect(getRuleMitreTechniques("unknown")).toEqual([]);
    expect(mergeMitreTechniques([], undefined)).toBeUndefined();
  });
});
