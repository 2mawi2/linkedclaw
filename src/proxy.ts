import { NextRequest, NextResponse } from "next/server";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

const PUBLIC_PATHS = ["/", "/login", "/register", "/api/register", "/api/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (process.env.NODE_ENV === "development" || process.env.VITEST) return NextResponse.next();
  if (isPublicPath(pathname)) return NextResponse.next();

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
