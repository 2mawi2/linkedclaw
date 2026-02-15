import { NextRequest, NextResponse } from "next/server";
import type { InValue } from "@libsql/client";
import { ensureDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

interface ActivityEvent {
  type: string;
  timestamp: string;
  match_id?: string;
  profile_id?: string;
  agent_id: string;
  summary: string;
}

export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json(
      { error: "agent_id query parameter is required" },
      { status: 400 }
    );
  }

  if (auth.agent_id !== agentId) {
    return NextResponse.json(
      { error: "Forbidden: agent_id does not match authenticated user" },
      { status: 403 }
    );
  }

  let limit = parseInt(searchParams.get("limit") || "20", 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  const since = searchParams.get("since");

  const db = await ensureDb();

  const profilesResult = await db.execute({
    sql: "SELECT id FROM profiles WHERE agent_id = ?",
    args: [agentId],
  });
  const profileIds = (profilesResult.rows as unknown as Array<{ id: string }>).map(
    (p) => p.id
  );

  if (profileIds.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const placeholders = profileIds.map(() => "?").join(",");
  const events: ActivityEvent[] = [];

  // 1. Match events (new_match)
  {
    let sql = `SELECT m.id as match_id, m.status, m.created_at,
      m.profile_a_id, m.profile_b_id,
      pa.agent_id as agent_a, pb.agent_id as agent_b
      FROM matches m
      JOIN profiles pa ON pa.id = m.profile_a_id
      JOIN profiles pb ON pb.id = m.profile_b_id
      WHERE (m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders}))`;
    const args: InValue[] = [...profileIds, ...profileIds];

    if (since) {
      sql += " AND m.created_at > ?";
      args.push(since);
    }

    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      const counterpart =
        profileIds.includes(row.profile_a_id as string)
          ? (row.agent_b as string)
          : (row.agent_a as string);
      const profileId = profileIds.includes(row.profile_a_id as string)
        ? (row.profile_a_id as string)
        : (row.profile_b_id as string);

      events.push({
        type: "new_match",
        timestamp: row.created_at as string,
        match_id: row.match_id as string,
        profile_id: profileId,
        agent_id: agentId,
        summary: `New match with agent ${counterpart}`,
      });
    }
  }

  // 2. Message events (message_received / deal_proposed)
  {
    let sql = `SELECT msg.id, msg.match_id, msg.sender_agent_id, msg.content, 
      msg.message_type, msg.created_at
      FROM messages msg
      JOIN matches m ON m.id = msg.match_id
      WHERE msg.sender_agent_id != ?
      AND (m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders}))`;
    const args: InValue[] = [agentId, ...profileIds, ...profileIds];

    if (since) {
      sql += " AND msg.created_at > ?";
      args.push(since);
    }

    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      const eventType =
        (row.message_type as string) === "proposal"
          ? "deal_proposed"
          : "message_received";
      const summary =
        eventType === "deal_proposed"
          ? `Deal proposed by agent ${row.sender_agent_id}`
          : `Message from agent ${row.sender_agent_id}`;

      events.push({
        type: eventType,
        timestamp: row.created_at as string,
        match_id: row.match_id as string,
        agent_id: agentId,
        summary,
      });
    }
  }

  // 3. Approval events (deal_approved, deal_rejected)
  {
    let sql = `SELECT a.id, a.match_id, a.agent_id as approver_id, a.approved, a.created_at
      FROM approvals a
      JOIN matches m ON m.id = a.match_id
      WHERE a.agent_id != ?
      AND (m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders}))`;
    const args: InValue[] = [agentId, ...profileIds, ...profileIds];

    if (since) {
      sql += " AND a.created_at > ?";
      args.push(since);
    }

    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      const approved = row.approved as number;
      events.push({
        type: approved ? "deal_approved" : "deal_rejected",
        timestamp: row.created_at as string,
        match_id: row.match_id as string,
        agent_id: agentId,
        summary: approved
          ? `Deal approved by agent ${row.approver_id}`
          : `Deal rejected by agent ${row.approver_id}`,
      });
    }
  }

  // 4. Expired matches
  {
    let sql = `SELECT m.id as match_id, m.expires_at,
      m.profile_a_id, m.profile_b_id
      FROM matches m
      WHERE m.status = 'expired'
      AND (m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders}))`;
    const args: InValue[] = [...profileIds, ...profileIds];

    if (since) {
      sql += " AND m.expires_at > ?";
      args.push(since);
    }

    const result = await db.execute({ sql, args });
    for (const row of result.rows) {
      if (row.expires_at) {
        events.push({
          type: "deal_expired",
          timestamp: row.expires_at as string,
          match_id: row.match_id as string,
          agent_id: agentId,
          summary: `Deal expired`,
        });
      }
    }
  }

  // Sort by timestamp descending
  events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const limited = events.slice(0, limit);

  return NextResponse.json({ events: limited });
}
