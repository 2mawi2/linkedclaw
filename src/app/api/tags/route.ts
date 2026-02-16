import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ensureDb } from "@/lib/db";

/**
 * GET /api/tags - List popular tags with counts (for discovery)
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "tags");
  if (rl) return rl;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50"), 1), 200);

  const db = await ensureDb();

  const result = await db.execute({
    sql: `SELECT pt.tag, COUNT(*) as count
          FROM profile_tags pt
          JOIN profiles p ON p.id = pt.profile_id AND p.active = 1
          GROUP BY pt.tag
          ORDER BY count DESC, pt.tag ASC
          LIMIT ?`,
    args: [limit],
  });

  return NextResponse.json({
    tags: result.rows.map((r) => ({
      tag: r.tag as string,
      count: r.count as number,
    })),
  });
}
