import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { jsonWithPagination, getBaseUrl } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agent_id query parameter is required" }, { status: 400 });
  }

  if (auth.agent_id !== agentId) {
    return NextResponse.json(
      { error: "Forbidden: agent_id does not match authenticated user" },
      { status: 403 },
    );
  }

  let limit = parseInt(searchParams.get("limit") || "20", 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);
  const unreadOnly = searchParams.get("unread_only") === "true";

  const db = await ensureDb();

  const countResult = await db.execute({
    sql: "SELECT COUNT(*) as cnt FROM notifications WHERE agent_id = ? AND read = 0",
    args: [agentId],
  });
  const unreadCount = Number((countResult.rows[0]?.cnt as number) ?? 0);

  // Total count for pagination (respects unread_only filter)
  const totalCountResult = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM notifications WHERE agent_id = ?${unreadOnly ? " AND read = 0" : ""}`,
    args: [agentId],
  });
  const total = Number((totalCountResult.rows[0]?.cnt as number) ?? 0);

  let sql =
    "SELECT id, type, match_id, from_agent_id, summary, read, created_at FROM notifications WHERE agent_id = ?";
  const args: (string | number)[] = [agentId];

  if (unreadOnly) {
    sql += " AND read = 0";
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  args.push(limit, offset);

  const result = await db.execute({ sql, args });

  const notifications = result.rows.map((row) => ({
    id: row.id as number,
    type: row.type as string,
    match_id: row.match_id as string | null,
    from_agent_id: row.from_agent_id as string | null,
    summary: row.summary as string,
    read: (row.read as number) === 1,
    created_at: row.created_at as string,
  }));

  return jsonWithPagination({
    unread_count: unreadCount,
    notifications,
  }, { total, limit, offset, baseUrl: getBaseUrl(req) });
}
