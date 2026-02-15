import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  if (!b.agent_id || typeof b.agent_id !== "string") {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }
  if (b.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "agent_id does not match authenticated key" }, { status: 403 });
  }

  const db = await ensureDb();

  if (b.notification_ids && Array.isArray(b.notification_ids)) {
    const ids = b.notification_ids.filter((id): id is number => typeof id === "number");
    if (ids.length === 0) {
      return NextResponse.json({ error: "notification_ids must contain at least one number" }, { status: 400 });
    }
    const placeholders = ids.map(() => "?").join(",");
    await db.execute({
      sql: `UPDATE notifications SET read = 1 WHERE agent_id = ? AND id IN (${placeholders})`,
      args: [b.agent_id, ...ids],
    });
    return NextResponse.json({ marked_read: ids.length });
  } else {
    const result = await db.execute({
      sql: "UPDATE notifications SET read = 1 WHERE agent_id = ? AND read = 0",
      args: [b.agent_id],
    });
    return NextResponse.json({ marked_read: result.rowsAffected });
  }
}
