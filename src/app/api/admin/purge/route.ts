import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";

/**
 * POST /api/admin/purge - Delete test/junk accounts and all associated data.
 * Requires ADMIN_SECRET env var to be set and passed as Bearer token.
 *
 * Body (optional):
 *   { "usernames": ["specific", "usernames"] }
 *
 * Without body: purges accounts matching known test patterns.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();

  let usernames: string[];
  try {
    const body = await req.json().catch(() => null);
    if (body && Array.isArray(body.usernames)) {
      usernames = body.usernames.filter((u: unknown) => typeof u === "string");
    } else {
      // Auto-detect test accounts by pattern
      const result = await db.execute(
        `SELECT username FROM users WHERE
          username LIKE 'test%' OR
          username LIKE 'e2e-%' OR
          username LIKE 'e2etest%' OR
          username LIKE 'skilltest%' OR
          username LIKE 'prod-test%' OR
          username LIKE 'persistcheck%' OR
          username LIKE 'persistence-test%' OR
          username LIKE 'lobster%test%' OR
          username LIKE 'lobsterbot%' OR
          username LIKE 'clientbot%' OR
          username LIKE 'testbot%' OR
          username LIKE 'maint-%' OR
          username LIKE 'mfix-%' OR
          username LIKE 'devcheck%' OR
          username LIKE 'devtest%' OR
          username LIKE 'flowtest-%' OR
          username LIKE 'dbg-%' OR
          username LIKE 'agent-dev%' OR
          username LIKE 'agent-client%' OR
          username LIKE 'cron-test-%' OR
          username LIKE 'notif-%' OR
          username LIKE 'rawtest%' OR
          username LIKE 'edev%' OR
          username LIKE 'eclient%'`,
      );
      usernames = result.rows.map((r) => String(r.username));
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (usernames.length === 0) {
    return NextResponse.json({ message: "No accounts to purge", purged: [] });
  }

  const purged: string[] = [];
  for (const username of usernames) {
    // Get user and their profiles
    const user = await db.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: [username],
    });
    if (user.rows.length === 0) continue;

    const userId = String(user.rows[0].id);

    // Get all profiles for this agent_id
    const profiles = await db.execute({
      sql: "SELECT id FROM profiles WHERE agent_id = ?",
      args: [username],
    });
    const profileIds = profiles.rows.map((r) => String(r.id));

    // Delete associated data
    for (const pid of profileIds) {
      await db.execute({
        sql: "DELETE FROM messages WHERE match_id IN (SELECT id FROM matches WHERE profile_a_id = ? OR profile_b_id = ?)",
        args: [pid, pid],
      });
      await db.execute({
        sql: "DELETE FROM approvals WHERE match_id IN (SELECT id FROM matches WHERE profile_a_id = ? OR profile_b_id = ?)",
        args: [pid, pid],
      });
      await db.execute({
        sql: "DELETE FROM deal_milestones WHERE match_id IN (SELECT id FROM matches WHERE profile_a_id = ? OR profile_b_id = ?)",
        args: [pid, pid],
      });
      await db.execute({
        sql: "DELETE FROM deal_completions WHERE match_id IN (SELECT id FROM matches WHERE profile_a_id = ? OR profile_b_id = ?)",
        args: [pid, pid],
      });
      await db.execute({
        sql: "DELETE FROM reviews WHERE match_id IN (SELECT id FROM matches WHERE profile_a_id = ? OR profile_b_id = ?)",
        args: [pid, pid],
      });
      await db.execute({
        sql: "DELETE FROM matches WHERE profile_a_id = ? OR profile_b_id = ?",
        args: [pid, pid],
      });
      await db.execute({ sql: "DELETE FROM profile_tags WHERE profile_id = ?", args: [pid] });
    }
    await db.execute({ sql: "DELETE FROM profiles WHERE agent_id = ?", args: [username] });
    await db.execute({ sql: "DELETE FROM notifications WHERE agent_id = ?", args: [username] });
    await db.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM api_keys WHERE user_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [userId] });

    purged.push(username);
  }

  return NextResponse.json({
    message: `Purged ${purged.length} test account(s)`,
    purged,
  });
}
