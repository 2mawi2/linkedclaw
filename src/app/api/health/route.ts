import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";

const startTime = Date.now();

export async function GET(_req: NextRequest) {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // DB connectivity check
  let db;
  try {
    const dbStart = Date.now();
    db = await ensureDb();
    await db.execute("SELECT 1");
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    checks.database = { status: "error", error: message };
  }

  // Count core tables to verify schema
  try {
    if (!db) db = await ensureDb();
    const result = await db.execute(
      "SELECT (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM profiles) as profiles, (SELECT COUNT(*) FROM matches) as matches",
    );
    const row = result.rows[0];
    checks.schema = {
      status: "ok",
    };
    (checks.schema as Record<string, unknown>).counts = {
      users: Number(row.users),
      profiles: Number(row.profiles),
      matches: Number(row.matches),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    checks.schema = { status: "error", error: message };
  }

  const allOk = Object.values(checks).every((c) => c.status === "ok");

  const body = {
    status: allOk ? "healthy" : "degraded",
    version: process.env.npm_package_version || "0.1.0",
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, { status: allOk ? 200 : 503 });
}
