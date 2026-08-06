import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";
import {
  listAgentTags,
  createAgentTag,
  deleteAgentTag,
  bulkSetAgentTags,
  listAllTags,
} from "../../../../../server/wazuh/agent-tags";
import { requirePermission } from "../../../../../server/authorization/require";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    requirePermission(user.permissions, "agents.read");

    const { agentId } = await context.params;

    if (request.url.includes("/api/agents/tags")) {
      // List all tags endpoint
      const tags = await listAllTags(db);
      return Response.json({ data: { tags } }, { headers: { "cache-control": "no-store" } });
    }

    // List tags for specific agent
    const tags = await listAgentTags(db, agentId);
    return Response.json({ data: { tags } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    requirePermission(user.permissions, "agents.manage");

    const { agentId } = await context.params;
    const body = await request.json();

    if (body?.tags && Array.isArray(body.tags)) {
      const result = await bulkSetAgentTags(db, agentId, body.tags, user.id);
      return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
    }

    if (body?.tag) {
      const tag = await createAgentTag(db, agentId, body.tag, user.id);
      return Response.json({ data: tag }, { status: 201 });
    }

    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
    requirePermission(user.permissions, "agents.manage");

    const { agentId } = await context.params;
    const { searchParams } = new URL(request.url);
    const tag = searchParams.get("tag");

    if (!tag) {
      return new Response(JSON.stringify({ error: "tag_required" }), { status: 400 });
    }

    await deleteAgentTag(db, agentId, tag);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
