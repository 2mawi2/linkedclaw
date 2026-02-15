import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const API_SECRET = process.env.API_SECRET || "";
const COOKIE_NAME = "lc_session";

function generateToken(): string {
  const payload = Date.now().toString();
  const sig = createHmac("sha256", API_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): boolean {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", API_SECRET).update(payload).digest("hex");
  return sig === expected;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password } = body;

  if (!API_SECRET || password !== API_SECRET) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = generateToken();
  const response = NextResponse.json({ ok: true });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return response;
}
