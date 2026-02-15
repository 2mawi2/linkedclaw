import { NextRequest, NextResponse } from "next/server";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

// Paths accessible without auth for any method (auth endpoints that need POST)
const PUBLIC_ANY_METHOD = ["/", "/login", "/register", "/api/register", "/api/login"];
// Paths accessible without auth for GET only (read-only discovery)
const PUBLIC_GET_ONLY = ["/api/stats", "/api/categories", "/api/search", "/api/tags", "/api/templates", "/api/projects", "/api/openapi.json"];
const PUBLIC_GET_PREFIXES = ["/api/agents/", "/api/reputation/", "/api/market/", "/api/connect/", "/api/profiles/"];

function isPublicPath(pathname: string, method: string): boolean {
  if (PUBLIC_ANY_METHOD.includes(pathname)) return true;
  if (method === "GET") {
    if (PUBLIC_GET_ONLY.includes(pathname)) return true;
    if (PUBLIC_GET_PREFIXES.some(p => pathname.startsWith(p))) return true;
  }
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (process.env.NODE_ENV === "development" || process.env.VITEST) return NextResponse.next();
  if (isPublicPath(pathname, request.method)) return NextResponse.next();

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer lc_")) return NextResponse.next();

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (sessionCookie) {
    const tokenHash = hashSessionToken(sessionCookie.value);
    const db = await ensureDb();
    const result = await db.execute({
      sql: "SELECT id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')",
      args: [tokenHash],
    });
    if (result.rows.length > 0) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Bearer token required. Register at POST /api/register" },
      { status: 401 }
    );
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
