import { z } from "zod";
import { createDatabase } from "../../../../../server/db/client";
import { loadConfig } from "../../../../../server/config";
import { authenticateRequest } from "../../../../../server/auth/authenticate";
import { listCaseNotes, addCaseNote } from "../../../../../server/cases/note-service";
import { assertCsrfSafe } from "../../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../../server/http/error-response";
import { SESSION_COOKIE } from "../../../../../server/auth/cookies";

const noteSchema = z.object({ body: z.string().trim().min(1).max(10_000) });

async function getUser(request: Request, db: Parameters<typeof authenticateRequest>[0]) {
  return authenticateRequest(db, request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    await getUser(request, db);
    const { id } = await context.params;
    return Response.json({ data: await listCaseNotes(db, id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const user = await getUser(request, db);
    const { id } = await context.params;
    const body = noteSchema.parse(await request.json());
    const note = await addCaseNote(db, { userId: user.id, role: user.role, permissions: new Set(user.permissions) }, id, body.body);
    return Response.json({ data: note }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
