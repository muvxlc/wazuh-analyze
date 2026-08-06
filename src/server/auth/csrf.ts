import "server-only";

import { AppError } from "../errors";

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function assertCsrfSafe(request: Request, appUrl: URL): void {
  if (!MUTATIONS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  if (!origin) throw new AppError("csrf_origin_missing", 403);
  if (origin !== appUrl.origin) throw new AppError("csrf_origin_mismatch", 403);
}
