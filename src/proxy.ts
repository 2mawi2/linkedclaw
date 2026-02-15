import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const ALLOWED_IPS = (process.env.ALLOWED_IPS || "").split(",").filter(Boolean);
const API_SECRET = process.env.API_SECRET || "";
const COOKIE_NAME = "lc_session";

// Public routes - no auth required
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/keys",      // Agent registration
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));
}

function verifySessionCookie(token: string): boolean {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", API_SECRET).update(payload).digest("hex");
  return sig === expected;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip protection in development/test
  if (process.env.NODE_ENV === "development" || process.env.VITEST) {
    return NextResponse.next();
  }

  // Public paths are always accessible
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check API secret header (admin access)
  const secret = request.headers.get("x-api-secret");
  if (API_SECRET && secret === API_SECRET) {
    return NextResponse.next();
  }

  // Check Bearer token (agent API key auth - handled per-route, let it through)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer lc_")) {
    return NextResponse.next();
  }

  // Check IP allowlist
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  if (ALLOWED_IPS.length > 0 && ALLOWED_IPS.includes(ip)) {
    return NextResponse.next();
  }

  // Check session cookie (browser login)
  const sessionCookie = request.cookies.get(COOKIE_NAME);
  if (sessionCookie && verifySessionCookie(sessionCookie.value)) {
    return NextResponse.next();
  }

  // API routes get 403, browser routes redirect to login
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Bearer token or API secret required" },
      { status: 401 }
    );
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
