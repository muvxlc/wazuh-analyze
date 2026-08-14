import "server-only";

import { and, gte, sql } from "drizzle-orm";
import type { Database } from "../db/types";
import * as schema from "../db/schema";

import type { WazuhConfig } from "../wazuh/types";
import {
  fetchAgentHealth,
  fetchAgentSca,
  fetchProcesses,
  fetchPorts,
  fetchPackages,
  fetchRootcheck,
  fetchServices,
  fetchSyscheck,
  fetchSyscollector,
} from "../wazuh/inventory";
import { findRelatedAlerts, type RelatedAlert } from "./correlate";
import { fetchAgentVulnerabilities } from "../wazuh/indexer";
import { resolveRecipe, type EnrichmentKey } from "./recipe";
import { lookupIp, type TiCacheStore, type TiProvider, type TiVerdict } from "../ti/provider";

/** Soft budget for the serialized context block fed to the LLM. */
export const CONTEXT_BUDGET_BYTES = 12_000;
const VULNERABILITY_BUDGET_BYTES = 3_000;

function capVulnerabilities(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const critical = value.filter((item) =>
    typeof item === "object" && item !== null &&
    String((item as { severity?: unknown }).severity ?? "").toLowerCase() === "critical",
  );
  const ordered = [...critical, ...value.filter((item) => !critical.includes(item))];
  const kept: unknown[] = [];
  for (const item of ordered) {
    const candidate = [...kept, item];
    if (JSON.stringify(candidate).length > VULNERABILITY_BUDGET_BYTES) break;
    kept.push(item);
  }
  return kept;
}

export interface BuildContextInput {
  alertId: string;
  agentId: string | null;
  ruleId: string | null;
  wazuhTimestamp: Date;
  groups: string[];
  level: number;
  rawPayload: unknown;
  /** Override the group-derived recipe (mainly for tests). */
  recipe?: EnrichmentKey[];
}

export interface ContextDeps {
  /** Postgres handle; when absent, relatedAlerts is skipped. */
  db?: Database;
  /** Wazuh REST config + injectable fetch; when absent, inventory keys are skipped. */
  wazuh?: { config: WazuhConfig; fetchFn?: typeof fetch };
  /** Threat-intel providers + cache; when absent, threatIntel is skipped. */
  ti?: { providers: TiProvider[]; cache?: TiCacheStore; fetchFn?: typeof fetch };
}

export interface AnalysisContext {
  enrichmentsUsed: string[];
  iocLookups: TiVerdict[];
  sections: Record<string, unknown>;
}

/** Extract IPv4 srcip from a Wazuh alert raw payload (data.srcip). */
export function extractSrcIp(rawPayload: unknown): string | null {
  if (typeof rawPayload !== "object" || rawPayload === null) return null;
  const data = (rawPayload as { data?: Record<string, unknown> }).data;
  const ip = data?.srcip;
  return typeof ip === "string" && ip.length > 0 ? ip : null;
}

/** Extract destination IPv4/IPv6 from a Wazuh alert raw payload (data.dstip, fallback decoder.dstip). */
export function extractDstIp(rawPayload: unknown): string | null {
  if (typeof rawPayload !== "object" || rawPayload === null) return null;
  const root = rawPayload as { data?: Record<string, unknown>; decoder?: Record<string, unknown> };
  const ip = root.data?.dstip ?? root.decoder?.dstip;
  return typeof ip === "string" && ip.length > 0 ? ip : null;
}

/** Extract destination port from a Wazuh alert raw payload (data.dstport). */
export function extractDstPort(rawPayload: unknown): string | null {
  if (typeof rawPayload !== "object" || rawPayload === null) return null;
  const data = (rawPayload as { data?: Record<string, unknown> }).data;
  const port = data?.dstport;
  return typeof port === "string" && port.length > 0 ? port : null;
}


/**
 * Drop the largest sections until the serialized context fits the budget.
 * Keeps JSON valid (never hard-truncates mid-string). ponytail: per-section
 * proportional cap if a single section dominates in production.
 */
export function trimToBudget(
  sections: Record<string, unknown>,
  budget = CONTEXT_BUDGET_BYTES,
): Record<string, unknown> {
  let current = { ...sections };
  if (JSON.stringify(current).length <= budget) return current;

  const bySizeDesc = Object.keys(current)
    .map((key) => ({ key, size: JSON.stringify(current[key]).length }))
    .sort((a, b) => b.size - a.size);

  for (const { key } of bySizeDesc) {
    delete current[key];
    if (JSON.stringify(current).length <= budget) break;
  }
  return current;
}

/**
 * Builds the LLM analysis context: resolves the recipe, fans out fetchers with
 * Promise.allSettled (per-source failures swallowed), and trims to budget.
 * Never throws — returns whatever it could gather. Redaction/cap stays in the
 * prompt builder (T1.7).
 */
export async function buildAnalysisContext(
  input: BuildContextInput,
  deps: ContextDeps,
): Promise<AnalysisContext> {
  const recipe = input.recipe ?? resolveRecipe(input.groups);
  const srcip = extractSrcIp(input.rawPayload);
  const dstip = extractDstIp(input.rawPayload);
  const dstport = extractDstPort(input.rawPayload);
  const wazuh = deps.wazuh;
  const agentId = input.agentId;
  const fetchFn = wazuh?.fetchFn;

  const thunks: Record<EnrichmentKey, () => Promise<unknown>> = {
    relatedAlerts: async (): Promise<RelatedAlert[]> =>
      deps.db
        ? findRelatedAlerts(deps.db as Database, {
            alertId: input.alertId,
            agentId,
            ruleId: input.ruleId,
            wazuhTimestamp: input.wazuhTimestamp,
          })
        : [],
    health: async () => (wazuh ? fetchAgentHealth(wazuh.config, { fetchFn }) : null),
    sca: async () => (wazuh && agentId ? fetchAgentSca(wazuh.config, agentId, { fetchFn }) : null),
    rootcheck: async () => (wazuh && agentId ? fetchRootcheck(wazuh.config, agentId, { fetchFn }) : null),
    syscheck: async () => (wazuh && agentId ? fetchSyscheck(wazuh.config, agentId, { fetchFn }) : null),
    processes: async () => (wazuh && agentId ? fetchProcesses(wazuh.config, agentId, { fetchFn }) : null),
    ports: async () => (wazuh && agentId ? fetchPorts(wazuh.config, agentId, { fetchFn }) : null),
    packages: async () => (wazuh && agentId ? fetchPackages(wazuh.config, agentId, { fetchFn }) : null),
    services: async () => (wazuh && agentId ? fetchServices(wazuh.config, agentId, { fetchFn }) : null),
    vulnerabilities: async () => (wazuh && agentId ? fetchAgentVulnerabilities(wazuh.config, agentId, 20) : null),
    threatIntel: async () => {
      if (!deps.ti) return null;
      const lookups = [srcip, dstip].filter((ip): ip is string => ip !== null);
      if (lookups.length === 0) return null;
      const settled = await Promise.allSettled(
        lookups.map((ip) =>
          lookupIp(ip, deps.ti!.providers, { cache: deps.ti!.cache, fetchFn: deps.ti!.fetchFn }),
        ),
      );
      return settled.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      );
    },
    networkFrequency: async () => {
      if (!deps.db || (!srcip && !dstip && !dstport)) return null;
      const cutoff = new Date(input.wazuhTimestamp.getTime() - 5 * 60 * 1000);
      const conditions = [sql`${schema.alerts.wazuhTimestamp} >= ${cutoff}`];
      if (srcip) conditions.push(sql`(${schema.alerts.rawPayload}->'data'->>'srcip') = ${srcip}`);
      if (dstip) conditions.push(sql`(${schema.alerts.rawPayload}->'data'->>'dstip') = ${dstip}`);
      if (dstport) conditions.push(sql`(${schema.alerts.rawPayload}->'data'->>'dstport') = ${dstport}`);
      const [row] = await deps.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.alerts)
        .where(and(...conditions));
      return { count: row?.count ?? 0, windowMinutes: 5 };
    },
  };

  const keys = recipe.filter((k) => k in thunks) as EnrichmentKey[];
  const settled = await Promise.allSettled(keys.map((k) => thunks[k]()));

  const sections: Record<string, unknown> = {};
  const enrichmentsUsed: string[] = [];
  const iocLookups: TiVerdict[] = [];

  keys.forEach((key, i) => {
    const result = settled[i];
    if (result.status !== "fulfilled") return;
    const value = result.value;
    if (key === "threatIntel") {
      if (Array.isArray(value)) iocLookups.push(...(value as TiVerdict[]));
      if (Array.isArray(value) && value.length > 0) enrichmentsUsed.push(key);
      return;
    }
    let cappedValue = value;
    if (key === "vulnerabilities") {
      cappedValue = capVulnerabilities(value);
    }
    const isEmpty =
      cappedValue === null ||
      cappedValue === undefined ||
      (Array.isArray(cappedValue) && cappedValue.length === 0);
    if (isEmpty) return;
    sections[key] = cappedValue;
    enrichmentsUsed.push(key);
  });

  return {
    enrichmentsUsed,
    iocLookups,
    sections: trimToBudget(sections),
  };
}

export type { TiVerdict };
export { fetchSyscollector };
