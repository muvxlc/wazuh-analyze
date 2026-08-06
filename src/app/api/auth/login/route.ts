import { eq } from "drizzle-orm";

import * as schema from "../../../../server/db/schema";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { loginSchema } from "../../../../server/auth/schemas";
import { verifyPassword } from "../../../../server/auth/password";
import { createSession, rotateSession } from "../../../../server/auth/session";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../server/http/error-response";

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_input" } }, { status: 422 });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.normalizedEmail, parsed.data.email.toLowerCase())).limit(1);
    if (!user || !user.isActive || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
      return Response.json({ error: { code: "invalid_credentials" } }, { status: 401 });
    }
    const session = await db.transaction((tx) => rotateSession(tx, user.id));
    const response = Response.json({ data: { userId: user.id, locale: user.locale } });
    response.headers.append("set-cookie", `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax${config.nodeEnv === "development" ? "" : "; Secure"}`);
    return response;
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
