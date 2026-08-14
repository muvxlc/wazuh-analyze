import { z } from "zod";
import { createDatabase } from "../../../../server/db/client";
import { loadConfig } from "../../../../server/config";
import { authenticateRequest } from "../../../../server/auth/authenticate";
import { toErrorResponse } from "../../../../server/http/error-response";
import { requirePermission } from "../../../../server/authorization/require";
import { SESSION_COOKIE } from "../../../../server/auth/cookies";
import {
  setSourceEnabled,
  setFreshnessSla,
} from "../../../../server/source-coverage/service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sourceKey: string }> },
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const user = await authenticateRequest(
      db,
      request.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null,
    );
    requirePermission(user.permissions, "settings.manage");

    const { sourceKey } = await context.params;
    const body = z
      .object({
        enabled: z.boolean().optional(),
        freshnessSlaMs: z.number().int().min(0).optional(),
      })
      .refine((v) => v.enabled !== undefined || v.freshnessSlaMs !== undefined, {
        message: "at least one of enabled or freshnessSlaMs required",
      })
      .parse(await request.json());

    let data;
    if (body.enabled !== undefined) {
      data = await setSourceEnabled(db, sourceKey, body.enabled);
    } else {
      data = await setFreshnessSla(db, sourceKey, body.freshnessSlaMs!);
    }
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, requestId);
  } finally {
    await pool.end();
  }
}
