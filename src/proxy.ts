import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Next 16 request interceptor (replaces middleware.ts). Optimistic only: it checks for the
// presence of the session cookie to redirect obviously anonymous visitors; every layout,
// page, server action and route handler re-checks the session and permissions itself.
// The public token routes (/c/*, /a/*), the auth API, the health route and static assets are
// never intercepted (see `matcher`).
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = !!getSessionCookie(request);
  const protectedPath =
    pathname.startsWith("/d/") ||
    pathname.startsWith("/admin") ||
    pathname === "/select-department";
  if (!hasSession && protectedPath) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/select-department", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|api/health|_next|favicon.ico|public|c/|a/).*)"],
};
