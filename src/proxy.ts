import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/app/api/auth/login/route";

const ALLOWED_IPS = (process.env.ALLOWED_IPS || "").split(",").filter(Boolean);
const API_SECRET = process.env.API_SECRET || "";
const COOKIE_NAME = "lc_session";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/keys",
  "/api/stats",
  "/api/categories",
  "/api/tags",
  "/api/search",
  "/api/projects",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.NODE_ENV === "development" || process.env.VITEST) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const secret = request.headers.get("x-api-secret");
  if (API_SECRET && secret === API_SECRET) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer lc_")) {
    return NextResponse.next();
  }

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  if (ALLOWED_IPS.length > 0 && ALLOWED_IPS.includes(ip)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(COOKIE_NAME);
  if (sessionCookie && verifyToken(sessionCookie.value)) {
    return NextResponse.next();
  }

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
