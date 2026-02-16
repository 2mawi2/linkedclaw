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

  // Support notification_ids (array) or delete all read
  const ids: number[] = [];
  if (b.notification_ids && Array.isArray(b.notification_ids)) {
    ids.push(...b.notification_ids.filter((id): id is number => typeof id === "number"));
  }

  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const result = await db.execute({
      sql: `DELETE FROM notifications WHERE agent_id = ? AND id IN (${placeholders})`,
      args: [b.agent_id, ...ids],
    });
    return NextResponse.json({ deleted: result.rowsAffected });
  } else if (b.read_only === true) {
    // Delete all read notifications
    const result = await db.execute({
      sql: "DELETE FROM notifications WHERE agent_id = ? AND read = 1",
      args: [b.agent_id],
    });
    return NextResponse.json({ deleted: result.rowsAffected });
  } else {
    return NextResponse.json(
      {
        error:
          "Provide notification_ids (array of numbers) or set read_only: true to delete all read notifications",
      },
      { status: 400 },
    );
  }
}
