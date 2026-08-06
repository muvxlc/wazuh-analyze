import "server-only";

import type { WazuhAgent } from "./types";

export interface AgentGroupIndex {
  /** agentId -> groups */
  byAgentId: Map<string, string[]>;
  /** distinct groups across live agents */
  groups: string[];
}

export function indexAgentGroups(agents: WazuhAgent[]): AgentGroupIndex {
  const byAgentId = new Map<string, string[]>();
  const groupSet = new Set<string>();
  for (const agent of agents) {
    const groups = agent.groups ?? [];
    byAgentId.set(agent.id, groups);
    for (const g of groups) groupSet.add(g);
  }
  return { byAgentId, groups: Array.from(groupSet).sort() };
}

/**
 * Resolve filter `groups` to the set of live agent IDs that belong to any of
 * those groups. Returns undefined when no groups are requested.
 */
export function resolveAgentIdsForGroups(
  index: AgentGroupIndex,
  groups: string[] | undefined,
): string[] | undefined {
  if (!groups?.length) return undefined;
  const wanted = new Set(groups);
  const ids: string[] = [];
  for (const [agentId, agentGroups] of index.byAgentId) {
    if (agentGroups.some((g) => wanted.has(g))) ids.push(agentId);
  }
  return ids;
}

/**
 * Merge live Wazuh agent groups into stored alert rows. Stored non-empty
 * groups are preserved; empty stored groups are filled from the live agent
 * when available.
 */
export function mergeAgentGroups<T extends { agentId: string | null; groups: string[] }>(
  items: T[],
  index: AgentGroupIndex,
): T[] {
  if (index.byAgentId.size === 0) return items;
  return items.map((item) => {
    if (item.groups.length > 0 || !item.agentId) return item;
    const live = index.byAgentId.get(item.agentId);
    if (!live || live.length === 0) return item;
    return { ...item, groups: live };
  });
}
