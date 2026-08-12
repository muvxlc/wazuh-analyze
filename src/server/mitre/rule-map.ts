import type { AiVerdict } from "../ai/analysis";

export type MitreTechnique = NonNullable<AiVerdict["mitreAttack"]>[number];

// Only map rules with a direct, defensible ATT&CK relationship. Unknown rules
// stay AI-only; guessed mappings would pollute SOC metrics.
const RULE_MITRE_MAP: Record<string, MitreTechnique[]> = {
  // Wazuh rule 533: "Listened ports status (netstat) changed".
  "533": [{ techniqueId: "T1046", techniqueName: "Network Service Scanning", tactic: "Discovery" }],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** Prefer Wazuh-native rule.mitre; use narrow fallback map only when absent. */
export function getRuleMitreTechniques(ruleId: string | null, rawPayload?: unknown): MitreTechnique[] {
  if (isObject(rawPayload) && isObject(rawPayload.rule) && isObject(rawPayload.rule.mitre)) {
    const mitre = rawPayload.rule.mitre;
    const ids = strings(mitre.id);
    const names = strings(mitre.technique);
    const tactics = strings(mitre.tactic);
    return ids
      .filter((id) => /^T\d{4}(\.\d{3})?$/i.test(id))
      .map((id, index) => ({
        techniqueId: id.toUpperCase(),
        techniqueName: names[index],
        tactic: tactics[index],
      }));
  }
  return ruleId ? (RULE_MITRE_MAP[ruleId] ?? []) : [];
}

export function mergeMitreTechniques(
  ruleTechniques: MitreTechnique[],
  aiTechniques: MitreTechnique[] | undefined,
): MitreTechnique[] | undefined {
  const merged = [...ruleTechniques, ...(aiTechniques ?? [])];
  const unique = new Map<string, MitreTechnique>();
  for (const technique of merged) {
    const id = technique.techniqueId.toUpperCase();
    if (!unique.has(id)) unique.set(id, { ...technique, techniqueId: id });
  }
  return unique.size > 0 ? [...unique.values()] : undefined;
}
