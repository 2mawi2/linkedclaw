import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
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
    return NextResponse.json(
      { error: "agent_id does not match authenticated key" },
      { status: 403 },
    );
  }

  const db = await ensureDb();

  // Support both notification_id (single) and notification_ids (array)
  const ids: number[] = [];
  if (b.notification_ids && Array.isArray(b.notification_ids)) {
    ids.push(...b.notification_ids.filter((id): id is number => typeof id === "number"));
  } else if (typeof b.notification_id === "number") {
    ids.push(b.notification_id);
  } else if (typeof b.notification_id === "string" && /^\d+$/.test(b.notification_id)) {
    ids.push(parseInt(b.notification_id, 10));
  }

  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    await db.execute({
      sql: `UPDATE notifications SET read = 1 WHERE agent_id = ? AND id IN (${placeholders})`,
      args: [b.agent_id, ...ids],
    });
    return NextResponse.json({ marked_read: ids.length });
  } else if (!b.notification_id && !b.notification_ids) {
    // No IDs specified - mark all as read
    const result = await db.execute({
      sql: "UPDATE notifications SET read = 1 WHERE agent_id = ? AND read = 0",
      args: [b.agent_id],
    });
    return NextResponse.json({ marked_read: result.rowsAffected });
  } else {
    return NextResponse.json(
      { error: "notification_id must be a number, or notification_ids must be an array of numbers" },
      { status: 400 },
    );
  }
}
