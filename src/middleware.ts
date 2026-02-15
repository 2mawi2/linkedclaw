import { NextRequest, NextResponse } from "next/server";

const ALLOWED_IPS = (process.env.ALLOWED_IPS || "").split(",").filter(Boolean);
const API_SECRET = process.env.API_SECRET || "";

export function middleware(request: NextRequest) {
  // Skip protection in development/test
  if (process.env.NODE_ENV === "development" || process.env.VITEST) {
    return NextResponse.next();
  }

  // Check API secret header first (agents can use this)
  const secret = request.headers.get("x-api-secret");
  if (API_SECRET && secret === API_SECRET) {
    return NextResponse.next();
  }

  // Check IP allowlist
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";

  if (ALLOWED_IPS.length > 0 && ALLOWED_IPS.includes(ip)) {
    return NextResponse.next();
  }

  // Check Vercel deployment protection bypass (for Vercel Password Protection)
  const bypassCookie = request.cookies.get("_vercel_jwt");
  if (bypassCookie) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { error: "Forbidden", message: "Access restricted" },
    { status: 403 }
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
