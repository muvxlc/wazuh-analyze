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

  if (token && isAuthPage) {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
