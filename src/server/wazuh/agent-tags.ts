import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { AppError } from "../errors";

const MIN_TAG_LENGTH = 1;
const MAX_TAG_LENGTH = 64;
const TAG_REGEX = /^[a-zA-Z0-9_\-./]+$/;

export class AgentTagError extends AppError {
  constructor(code: string, status: number, details?: Record<string, unknown>) {
    super(code, status, details);
    this.name = "AgentTagError";
  }
}

export interface AgentTag {
  id: string;
  agentId: string;
  tag: string;
  createdByUserId: string | null;
  createdAt: Date;
}

export function validateTag(tag: string): string {
  if (!tag || typeof tag !== "string") throw new AgentTagError("invalid_tag", 400, { tag });
  const normalized = tag.trim();
  if (normalized.length < MIN_TAG_LENGTH || normalized.length > MAX_TAG_LENGTH) {
    throw new AgentTagError("invalid_tag", 400, { tag: normalized });
  }
  if (!TAG_REGEX.test(normalized)) {
    throw new AgentTagError("invalid_tag", 400, { tag: normalized });
  }
  return normalized;
}

export async function listAgentTags(db: Database, agentId: string): Promise<AgentTag[]> {
  return db
    .select()
    .from(schema.agentTags)
    .where(eq(schema.agentTags.agentId, agentId))
    .orderBy(schema.agentTags.createdAt);
}

export async function createAgentTag(
  db: Database,
  agentId: string,
  tag: string,
  createdByUserId: string | null,
): Promise<AgentTag> {
  const normalized = validateTag(tag);
  const [row] = await db
    .insert(schema.agentTags)
    .values({ agentId, tag: normalized, createdByUserId })
    .returning();

  if (!row) throw new AgentTagError("tag_create_failed", 500);
  return row as AgentTag;
}

export async function deleteAgentTag(
  db: Database,
  agentId: string,
  tag: string,
): Promise<void> {
  const normalized = validateTag(tag);
  const [row] = await db
    .delete(schema.agentTags)
    .where(and(eq(schema.agentTags.agentId, agentId), eq(schema.agentTags.tag, normalized)))
    .returning({ id: schema.agentTags.id });

  if (!row) throw new AgentTagError("tag_not_found", 404, { agentId, tag: normalized });
}

export async function bulkSetAgentTags(
  db: Database,
  agentId: string,
  tags: string[],
  userId: string,
): Promise<{ added: string[]; removed: string[] }> {
  const normalizedTags = [...new Set(tags.map(validateTag))];

  return db.transaction(async (tx) => {
    const existing = await listAgentTags(tx, agentId);
    const existingTagSet = new Set(existing.map((t) => t.tag));
    const desiredTagSet = new Set(normalizedTags);
    const toAdd = normalizedTags.filter((t) => !existingTagSet.has(t));
    const toRemove = existing.filter((t) => !desiredTagSet.has(t.tag));

    if (toAdd.length > 0) {
      await tx.insert(schema.agentTags).values(
        toAdd.map((tag) => ({ agentId, tag, createdByUserId: userId })),
      );
    }

    if (toRemove.length > 0) {
      await tx.delete(schema.agentTags)
        .where(inArray(schema.agentTags.id, toRemove.map((t) => t.id)));
    }

    return { added: toAdd, removed: toRemove.map((t) => t.tag) };
  });
}

export async function listAllTags(db: Database): Promise<string[]> {
  const rows = await db
    .select({ tag: schema.agentTags.tag })
    .from(schema.agentTags)
    .groupBy(schema.agentTags.tag)
    .orderBy(schema.agentTags.tag);

  return rows.map((row) => row.tag);
}

export async function listAgentTagsForAgents(
  db: Database,
  agentIds: readonly string[],
): Promise<Record<string, AgentTag[]>> {
  const uniqueIds = [...new Set(agentIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const rows = await db
    .select()
    .from(schema.agentTags)
    .where(inArray(schema.agentTags.agentId, uniqueIds))
    .orderBy(schema.agentTags.createdAt);
  const map: Record<string, AgentTag[]> = {};
  for (const row of rows) {
    (map[row.agentId] ??= []).push(row as AgentTag);
  }
  return map;
}
