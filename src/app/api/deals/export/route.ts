import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

interface ExportRow {
  match_id: string;
  status: string;
  counterpart_agent_id: string;
  counterpart_description: string | null;
  category: string;
  side: string;
  overlap_summary: string;
  proposed_terms: string | null;
  message_count: number;
  created_at: string;
  completed_at: string | null;
  review_rating: number | null;
  review_text: string | null;
}

function escapeCSV(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(row: Record<string, unknown>, headers: string[]): string {
  return headers.map((h) => escapeCSV(String(row[h] ?? ""))).join(",");
}

/**
 * GET /api/deals/export?agent_id=...&format=csv|json
 *
 * Export deal history for an agent. Requires authentication.
 * format defaults to "json". CSV returns a downloadable file.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "deals-export");
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id");
  const format = searchParams.get("format") ?? "json";

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json(
      { error: "agent_id query parameter is required" },
      { status: 400 },
    );
  }

  // Only allow exporting your own deals
  if (agentId !== auth.agent_id) {
    return NextResponse.json(
      { error: "You can only export your own deal history" },
      { status: 403 },
    );
  }

  if (format !== "csv" && format !== "json") {
    return NextResponse.json(
      { error: "format must be 'csv' or 'json'" },
      { status: 400 },
    );
  }

  const db = await ensureDb();

  // Find all profile ids for this agent
  const profilesResult = await db.execute({
    sql: "SELECT id FROM profiles WHERE agent_id = ?",
    args: [agentId],
  });
  const profiles = profilesResult.rows as unknown as Array<{ id: string }>;

  if (profiles.length === 0) {
    if (format === "csv") {
      return new Response("No deals found", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${agentId}-deals.csv"`,
        },
      });
    }
    return NextResponse.json({ deals: [], total: 0 });
  }

  const profileIds = profiles.map((p) => p.id);
  const placeholders = profileIds.map(() => "?").join(",");

  const result = await db.execute({
    sql: `SELECT
        m.id as match_id,
        m.status,
        m.overlap_summary,
        m.created_at,
        CASE
          WHEN m.profile_a_id IN (${placeholders}) THEN pb.agent_id
          ELSE pa.agent_id
        END as counterpart_agent_id,
        CASE
          WHEN m.profile_a_id IN (${placeholders}) THEN pb.description
          ELSE pa.description
        END as counterpart_description,
        CASE
          WHEN m.profile_a_id IN (${placeholders}) THEN pa.category
          ELSE pb.category
        END as category,
        CASE
          WHEN m.profile_a_id IN (${placeholders}) THEN pa.side
          ELSE pb.side
        END as side,
        COALESCE(mc.cnt, 0) as message_count,
        pt.proposed_terms,
        comp.completed_at,
        r.rating as review_rating,
        r.review_text
      FROM matches m
      JOIN profiles pa ON pa.id = m.profile_a_id
      JOIN profiles pb ON pb.id = m.profile_b_id
      LEFT JOIN (
        SELECT match_id, COUNT(*) as cnt FROM messages GROUP BY match_id
      ) mc ON mc.match_id = m.id
      LEFT JOIN (
        SELECT match_id, proposed_terms
        FROM messages
        WHERE message_type = 'proposal' AND proposed_terms IS NOT NULL
        GROUP BY match_id
        HAVING id = MAX(id)
      ) pt ON pt.match_id = m.id
      LEFT JOIN (
        SELECT match_id, MAX(created_at) as completed_at
        FROM messages
        WHERE content LIKE '%completed%' OR content LIKE '%complete%'
        GROUP BY match_id
      ) comp ON comp.match_id = m.id AND m.status IN ('completed', 'in_progress')
      LEFT JOIN (
        SELECT match_id, rating, comment as review_text
        FROM reviews
        WHERE reviewer_agent_id = ?
      ) r ON r.match_id = m.id
      WHERE m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders})
      ORDER BY m.created_at DESC`,
    args: [
      ...profileIds,
      ...profileIds,
      ...profileIds,
      ...profileIds,
      agentId,
      ...profileIds,
      ...profileIds,
    ],
  });

  const rows = result.rows as unknown as ExportRow[];

  const deals = rows.map((row) => {
    let terms = null;
    if (row.proposed_terms) {
      try {
        terms = JSON.parse(row.proposed_terms);
      } catch {
        terms = null;
      }
    }
    let overlap = null;
    if (row.overlap_summary) {
      try {
        overlap = JSON.parse(row.overlap_summary);
      } catch {
        overlap = null;
      }
    }

    return {
      match_id: row.match_id,
      status: row.status,
      counterpart_agent_id: row.counterpart_agent_id,
      counterpart_description: row.counterpart_description,
      category: row.category,
      side: row.side,
      shared_skills: overlap?.shared_skills?.join("; ") ?? "",
      match_score: overlap?.score ?? null,
      proposed_rate: terms?.rate ?? null,
      proposed_currency: terms?.currency ?? null,
      proposed_hours_per_week: terms?.hours_per_week ?? null,
      proposed_duration_weeks: terms?.duration_weeks ?? null,
      message_count: Number(row.message_count),
      review_rating: row.review_rating,
      review_text: row.review_text,
      created_at: row.created_at,
      completed_at: row.completed_at,
    };
  });

  if (format === "csv") {
    const headers = [
      "match_id",
      "status",
      "counterpart_agent_id",
      "counterpart_description",
      "category",
      "side",
      "shared_skills",
      "match_score",
      "proposed_rate",
      "proposed_currency",
      "proposed_hours_per_week",
      "proposed_duration_weeks",
      "message_count",
      "review_rating",
      "review_text",
      "created_at",
      "completed_at",
    ];

    const csvLines = [
      headers.join(","),
      ...deals.map((d) => rowToCSV(d as unknown as Record<string, unknown>, headers)),
    ];

    return new Response(csvLines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${agentId}-deals.csv"`,
      },
    });
  }

  return NextResponse.json({ deals, total: deals.length });
}
