/**
 * Enrichment recipe: maps a Wazuh alert's rule groups to the set of context
 * fetchers that should run before LLM analysis. Pure function, no I/O —
 * the context builder (T1.6) interprets the recipe.
 *
 * ponytail: extend the keyword map as new rule groups appear in production.
 */
export type EnrichmentKey =
  | "relatedAlerts"
  | "health"
  | "sca"
  | "rootcheck"
  | "syscheck"
  | "processes"
  | "ports"
  | "packages"
  | "services"
  | "threatIntel";

interface RecipeRule {
  keywords: string[];
  keys: EnrichmentKey[];
}

const RECIPE_RULES: RecipeRule[] = [
  { keywords: ["auth", "sshd", "authentication", "authentication_success", "authentication_failed"], keys: ["relatedAlerts", "health", "processes"] },
  { keywords: ["rootcheck", "malware", "yara", "rootkit"], keys: ["rootcheck", "processes", "ports", "threatIntel"] },
  { keywords: ["syscheck", "fim", "file_integrity"], keys: ["syscheck"] },
  { keywords: ["sca", "policy_monitoring", "cis"], keys: ["sca"] },
  { keywords: ["syscollector", "inventory", "it_hygiene"], keys: ["processes", "ports", "packages", "services"] },
  { keywords: ["web", "attack", "exploit", "injection", "xss", "rfi", "lfi"], keys: ["relatedAlerts", "threatIntel"] },
];

const DEFAULT_RECIPE: EnrichmentKey[] = ["relatedAlerts", "health"];

export function resolveRecipe(groups: string[]): EnrichmentKey[] {
  const lower = groups.map((g) => g.toLowerCase());
  const matched = new Set<EnrichmentKey>();
  for (const rule of RECIPE_RULES) {
    if (rule.keywords.some((kw) => lower.some((g) => g === kw || g.includes(kw)))) {
      for (const key of rule.keys) matched.add(key);
    }
  }
  // High-severity traffic always warrants threat intel if a srcip is present
  return matched.size > 0 ? [...matched] : [...DEFAULT_RECIPE];
}
