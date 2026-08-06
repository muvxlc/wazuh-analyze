import { checkLiveness } from "../../../../server/health/health-service";
import { toErrorResponse } from "../../../../server/http/error-response";

export async function GET(request: Request): Promise<Response> {
  try {
    const status = checkLiveness();
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, request.headers.get("x-request-id") ?? crypto.randomUUID());
  }
}
