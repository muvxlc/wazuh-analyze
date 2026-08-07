import { AppError } from "../errors";

export function toErrorResponse(error: unknown, requestId: string): Response {
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : "internal_error";
  const details = error instanceof AppError ? error.details : undefined;

  return Response.json(
    { error: { code, requestId, ...(details?.upstreamStatus ? { upstreamStatus: details.upstreamStatus } : {}) } },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}
