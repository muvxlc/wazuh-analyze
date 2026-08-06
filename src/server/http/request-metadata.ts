export interface RequestMetadata {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export function getRequestMetadata(request: Request): RequestMetadata {
  const forwardedFor = request.headers.get("x-forwarded-for");

  return {
    requestId: request.headers.get("x-request-id") || crypto.randomUUID(),
    ip: forwardedFor?.split(",", 1)[0]?.trim() || null,
    userAgent: request.headers.get("user-agent"),
  };
}
