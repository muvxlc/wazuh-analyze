import { AppError } from "../errors";
import { ZodError } from "zod";

export function toErrorResponse(error: unknown, requestId: string): Response {
  // Zod parse failures are client errors (invalid query/body), not server faults.
  if (error instanceof ZodError) {
    return Response.json(
      { error: { code: "invalid_input", requestId } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
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
