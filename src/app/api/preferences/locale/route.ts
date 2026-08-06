import { z } from "zod";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

import * as schema from "../../../../server/db/schema";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../server/http/error-response";

const localeSchema = z.object({
  locale: z.enum(["en", "th"]),
});

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const parsed = localeSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_input" } }, { status: 422 });

    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? null;
    if (token) {
      const user = await authenticateRequest(db, token);
      await db.update(schema.users).set({ locale: parsed.data.locale, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
    }

    cookieStore.set("NEXT_LOCALE", parsed.data.locale, { path: "/", maxAge: 31536000, sameSite: "lax" });

    return Response.json({ data: { locale: parsed.data.locale } }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
