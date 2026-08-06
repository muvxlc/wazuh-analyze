import { AppError } from "../errors";

export function toErrorResponse(error: unknown, requestId: string): Response {
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : "internal_error";

  return Response.json(
    { error: { code, requestId } },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}
