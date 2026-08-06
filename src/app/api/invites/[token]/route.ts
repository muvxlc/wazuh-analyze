import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { inviteAcceptanceSchema } from "../../../../server/auth/schemas";
import { acceptInvite } from "../../../../server/users/invite-service";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import { assertCsrfSafe } from "../../../../server/auth/csrf";
import { toErrorResponse } from "../../../../server/http/error-response";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    assertCsrfSafe(request, config.appUrl);
    const { token } = await context.params;
    const parsed = inviteAcceptanceSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "invalid_input" } }, { status: 422 });
    const result = await acceptInvite(db, { token, ...parsed.data }, {
      requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    const response = Response.json({ data: { userId: result.userId } }, { status: 201 });
    response.headers.append("set-cookie", `${SESSION_COOKIE}=${result.session.token}; Path=/; HttpOnly; SameSite=Lax${config.nodeEnv === "development" ? "" : "; Secure"}`);
    return response;
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  } finally {
    await pool.end();
  }
}
