import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { v4 as uuidv4 } from "uuid";
import type { BountyStatus } from "@/lib/types";

const VALID_STATUSES: BountyStatus[] = ["open", "in_progress", "completed", "cancelled"];

/** GET /api/bounties - list bounties (public, no auth required) */
export async function GET(req: NextRequest) {
  const db = await ensureDb();
  const url = new URL(req.url);

  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status") || "open";
  const q = url.searchParams.get("q");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (status && VALID_STATUSES.includes(status as BountyStatus)) {
    conditions.push("b.status = ?");
    args.push(status);
  }
  if (category) {
    conditions.push("b.category = ?");
    args.push(category);
  }
  if (q) {
    conditions.push("(b.title LIKE ? OR b.description LIKE ? OR b.skills LIKE ?)");
    const pattern = `%${q}%`;
    args.push(pattern, pattern, pattern);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM bounties b ${where}`,
    args,
  });
  const total = Number(countResult.rows[0]?.total ?? 0);

  const result = await db.execute({
    sql: `SELECT b.* FROM bounties b ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  const bounties = result.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    creator_agent_id: r.creator_agent_id,
    title: r.title,
    description: r.description,
    category: r.category,
    skills: JSON.parse(String(r.skills || "[]")),
    budget_min: r.budget_min ?? null,
    budget_max: r.budget_max ?? null,
    currency: r.currency || "USD",
    deadline: r.deadline ?? null,
    status: r.status,
    assigned_agent_id: r.assigned_agent_id ?? null,
    created_at: r.created_at,
  }));

  return NextResponse.json({ total, bounties });
}

/** POST /api/bounties - create a bounty (auth required) */
export async function POST(req: NextRequest) {
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const limited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    agent_id,
    title,
    description,
    category,
    skills,
    budget_min,
    budget_max,
    currency,
    deadline,
  } = body as Record<string, unknown>;

  if (!agent_id || typeof agent_id !== "string") {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!category || typeof category !== "string" || category.trim().length === 0) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }

  const skillsArr = Array.isArray(skills)
    ? skills.filter((s: unknown) => typeof s === "string")
    : [];
  const id = uuidv4();

  const db = await ensureDb();
  await db.execute({
    sql: `INSERT INTO bounties (id, creator_agent_id, title, description, category, skills, budget_min, budget_max, currency, deadline)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      String(agent_id),
      String(title).trim(),
      description ? String(description).trim() : null,
      String(category).trim(),
      JSON.stringify(skillsArr),
      budget_min != null ? Number(budget_min) : null,
      budget_max != null ? Number(budget_max) : null,
      currency ? String(currency) : "USD",
      deadline ? String(deadline) : null,
    ],
  });

  return NextResponse.json(
    {
      id,
      creator_agent_id: agent_id,
      title: String(title).trim(),
      category: String(category).trim(),
      status: "open",
    },
    { status: 201 },
  );
}
