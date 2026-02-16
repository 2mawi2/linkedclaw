import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const db = await ensureDb();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "open";
  const category = url.searchParams.get("category");
  const creator = url.searchParams.get("creator");
  const claimed_by = url.searchParams.get("claimed_by");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

  let sql = "SELECT * FROM bounties WHERE 1=1";
  const args: (string | number)[] = [];

  if (status !== "all") {
    sql += " AND status = ?";
    args.push(status);
  }
  if (category) {
    sql += " AND category = ?";
    args.push(category);
  }
  if (creator) {
    sql += " AND creator_agent_id = ?";
    args.push(creator);
  }
  if (claimed_by) {
    sql += " AND claimed_by = ?";
    args.push(claimed_by);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);

  const result = await db.execute({ sql, args });
  const bounties = result.rows.map((r) => ({
    ...r,
    skills: JSON.parse((r.skills as string) || "[]"),
  }));

  return NextResponse.json({ bounties, count: bounties.length });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = await ensureDb();
  const body = await req.json();
  const {
    agent_id,
    title,
    description,
    category,
    skills,
    reward_amount,
    reward_currency,
    deadline,
  } = body;

  if (!agent_id || !title || !description || !category) {
    return NextResponse.json(
      { error: "agent_id, title, description, and category are required" },
      { status: 400 },
    );
  }

  if (auth.agent_id !== agent_id) {
    return NextResponse.json(
      { error: "agent_id does not match authenticated user" },
      { status: 403 },
    );
  }

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO bounties (id, creator_agent_id, title, description, category, skills, reward_amount, reward_currency, deadline)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      agent_id,
      title,
      description,
      category,
      JSON.stringify(skills || []),
      reward_amount || null,
      reward_currency || "EUR",
      deadline || null,
    ],
  });

  return NextResponse.json(
    { bounty_id: id, status: "open", message: "Bounty created" },
    { status: 201 },
  );
}
