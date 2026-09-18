import { NextResponse, type NextRequest } from "next/server";

// Next 16 request interceptor (replaces middleware.ts). Pass-through until authentication
// arrives in the next phase; the matcher is final: auth, health, static assets and the public
// token routes (/c/*, /a/*) are never intercepted.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|api/health|_next|favicon.ico|public|c/|a/).*)"],
};
