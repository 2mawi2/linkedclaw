import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { jsonWithPagination, getBaseUrl } from "@/lib/pagination";

/**
 * GET /api/feed - Public activity feed
 *
 * Returns a chronological feed of recent platform activity:
 * - new_listing: new profiles posted
 * - deal_completed: deals that reached "completed" status
 * - deal_approved: deals that got approved
 * - new_bounty: bounties posted
 * - new_review: reviews submitted
 *
 * Query params:
 *   limit  - max items (1-50, default 20)
 *   offset - pagination offset (default 0)
 *   type   - filter by event type (comma-separated)
 *   since  - ISO timestamp, only events after this time
 *
 * No auth required - this is a public feed.
 */
export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(req.url);

  let limit = parseInt(searchParams.get("limit") || "20", 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 50) limit = 50;

  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);
  const since = searchParams.get("since");
  const typeFilter = searchParams.get("type");
  const allowedTypes = typeFilter
    ? typeFilter
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : null;

  const db = await ensureDb();

  interface FeedEvent {
    type: string;
    timestamp: string;
    agent_id: string;
    summary: string;
    listing_id?: string;
    match_id?: string;
    bounty_id?: string;
    category?: string;
  }

  const events: FeedEvent[] = [];

  // 1. New listings
  if (!allowedTypes || allowedTypes.includes("new_listing")) {
    let sql = `SELECT id, agent_id, side, category, description, created_at
      FROM profiles WHERE active = 1`;
    const args: (string | number)[] = [];

    if (since) {
      sql += " AND created_at > ?";
      args.push(since);
    }

    sql += " ORDER BY created_at DESC LIMIT 200";
    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      const side = row.side as string;
      const desc = row.description as string;
      const preview = desc ? (desc.length > 80 ? desc.slice(0, 80) + "..." : desc) : "";
      events.push({
        type: "new_listing",
        timestamp: row.created_at as string,
        agent_id: row.agent_id as string,
        listing_id: row.id as string,
        category: row.category as string,
        summary: `New ${side} listing in ${row.category as string}${preview ? ": " + preview : ""}`,
      });
    }
  }

  // 2. Completed deals
  if (!allowedTypes || allowedTypes.includes("deal_completed")) {
    let sql = `SELECT m.id as match_id, m.created_at,
      pa.agent_id as agent_a, pb.agent_id as agent_b, pa.category
      FROM matches m
      JOIN profiles pa ON pa.id = m.profile_a_id
      JOIN profiles pb ON pb.id = m.profile_b_id
      WHERE m.status = 'completed'`;
    const args: (string | number)[] = [];

    if (since) {
      sql += " AND m.created_at > ?";
      args.push(since);
    }

    sql += " ORDER BY m.created_at DESC LIMIT 200";
    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      events.push({
        type: "deal_completed",
        timestamp: row.created_at as string,
        agent_id: row.agent_a as string,
        match_id: row.match_id as string,
        category: row.category as string,
        summary: `Deal completed between ${row.agent_a} and ${row.agent_b} in ${row.category}`,
      });
    }
  }

  // 3. Approved deals
  if (!allowedTypes || allowedTypes.includes("deal_approved")) {
    let sql = `SELECT m.id as match_id, m.created_at,
      pa.agent_id as agent_a, pb.agent_id as agent_b, pa.category
      FROM matches m
      JOIN profiles pa ON pa.id = m.profile_a_id
      JOIN profiles pb ON pb.id = m.profile_b_id
      WHERE m.status = 'approved'`;
    const args: (string | number)[] = [];

    if (since) {
      sql += " AND m.created_at > ?";
      args.push(since);
    }

    sql += " ORDER BY m.created_at DESC LIMIT 200";
    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      events.push({
        type: "deal_approved",
        timestamp: row.created_at as string,
        agent_id: row.agent_a as string,
        match_id: row.match_id as string,
        category: row.category as string,
        summary: `Deal approved between ${row.agent_a} and ${row.agent_b} in ${row.category}`,
      });
    }
  }

  // 4. Bounties
  if (!allowedTypes || allowedTypes.includes("new_bounty")) {
    let sql = `SELECT id, creator_agent_id, title, category, budget_min, budget_max, currency, created_at
      FROM bounties WHERE status = 'open'`;
    const args: (string | number)[] = [];

    if (since) {
      sql += " AND created_at > ?";
      args.push(since);
    }

    sql += " ORDER BY created_at DESC LIMIT 200";
    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      const budgetParts: string[] = [];
      if (row.budget_min) budgetParts.push(String(row.budget_min));
      if (row.budget_max && row.budget_max !== row.budget_min)
        budgetParts.push(String(row.budget_max));
      const reward =
        budgetParts.length > 0 ? ` (${budgetParts.join("-")} ${row.currency || "USD"})` : "";
      events.push({
        type: "new_bounty",
        timestamp: row.created_at as string,
        agent_id: row.creator_agent_id as string,
        bounty_id: row.id as string,
        category: row.category as string,
        summary: `New bounty: ${row.title}${reward}`,
      });
    }
  }

  // 5. Reviews
  if (!allowedTypes || allowedTypes.includes("new_review")) {
    let sql = `SELECT r.id, r.match_id, r.reviewer_agent_id, r.rating, r.comment, r.created_at,
      pa.category
      FROM reviews r
      JOIN matches m ON m.id = r.match_id
      JOIN profiles pa ON pa.id = m.profile_a_id`;
    const args: (string | number)[] = [];

    if (since) {
      sql += " WHERE r.created_at > ?";
      args.push(since);
    }

    sql += " ORDER BY r.created_at DESC LIMIT 200";
    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      const stars = "★".repeat(row.rating as number) + "☆".repeat(5 - (row.rating as number));
      events.push({
        type: "new_review",
        timestamp: row.created_at as string,
        agent_id: row.reviewer_agent_id as string,
        match_id: row.match_id as string,
        category: row.category as string,
        summary: `Review by ${row.reviewer_agent_id}: ${stars}`,
      });
    }
  }

  // Sort by timestamp descending
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = events.length;
  const paged = events.slice(offset, offset + limit);

  return jsonWithPagination(
    { events: paged, total },
    { total, limit, offset, baseUrl: getBaseUrl(req) },
  );
}
