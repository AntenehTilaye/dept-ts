import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

// The interceptor is optimistic: it only looks for the better-auth session cookie.
function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://web.test${path}`, cookie ? { headers: { cookie } } : undefined);
}

const SESSION = "better-auth.session_token=abc.def";

describe("proxy", () => {
  it("sends anonymous visitors of protected paths to /login with a next parameter", () => {
    for (const path of [
      "/d/cs",
      "/d/cs/tasks?x=1",
      "/admin",
      "/admin/users",
      "/select-department",
    ]) {
      const res = proxy(req(path));
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(path);
    }
  });

  it("lets anonymous visitors reach public pages", () => {
    for (const path of ["/", "/login", "/reset-password", "/set-password?token=x"]) {
      expect(proxy(req(path)).status).toBe(200);
    }
  });

  it("keeps signed-in users away from /login and lets them through elsewhere", () => {
    const res = proxy(req("/login", SESSION));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/select-department");
    expect(proxy(req("/d/cs", SESSION)).status).toBe(200);
    expect(proxy(req("/admin", SESSION)).status).toBe(200);
  });

  it("never intercepts the auth api, health, public token routes or static assets", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of [
      "/api/auth/sign-in",
      "/api/health",
      "/_next/static/x.js",
      "/favicon.ico",
      "/c/token",
      "/a/token",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
    for (const path of ["/d/cs", "/login", "/admin/users", "/api/other"]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });
});
