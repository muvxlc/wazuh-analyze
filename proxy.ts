import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "./src/server/auth/cookies";

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/invite");
  const isApiRoute = pathname.startsWith("/api");
  const isPublicRoute = pathname.startsWith("/_next") || pathname === "/favicon.ico";

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // The proxy is edge-only and cannot verify session validity (no DB access).
  // It only enforces the *presence* of the cookie.
  // Let /api/* through regardless; API routes authenticate internally.
  if (!token && !isAuthPage && !isApiRoute) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Do not trust cookie presence here. Session tokens are DB-backed and may be
  // revoked or belong to a database that was replaced; the auth page must stay
  // reachable so users can recover from a stale cookie.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
