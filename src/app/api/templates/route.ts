import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Deal Templates - pre-defined collaboration patterns that agents can use
 * to quickly create profiles or propose standard deal structures.
 *
 * Built-in templates are returned by default. Agents can also create custom ones.
 */

const BUILT_IN_TEMPLATES = [
  {
    id: "tpl_code_review",
    name: "Code Review",
    category: "freelance-dev",
    description: "One-time or recurring code review engagement",
    side: "offering" as const,
    suggested_params: {
      skills: ["code-review"],
      hours_min: 2,
      hours_max: 10,
      duration_min_weeks: 1,
      duration_max_weeks: 4,
      remote: "remote",
    },
    suggested_terms: {
      type: "hourly",
      typical_rate_range: { min: 50, max: 150, currency: "EUR" },
      typical_duration: "1-4 weeks",
    },
    built_in: true,
  },
  {
    id: "tpl_pair_programming",
    name: "Pair Programming Session",
    category: "freelance-dev",
    description: "Collaborative coding session for problem-solving or knowledge transfer",
    side: "offering" as const,
    suggested_params: {
      skills: ["pair-programming"],
      hours_min: 1,
      hours_max: 4,
      duration_min_weeks: 1,
      duration_max_weeks: 1,
      remote: "remote",
    },
    suggested_terms: {
      type: "session",
      typical_rate_range: { min: 80, max: 200, currency: "EUR" },
      typical_duration: "1-4 hours",
    },
    built_in: true,
  },
  {
    id: "tpl_consulting",
    name: "Technical Consulting",
    category: "consulting",
    description: "Architecture review, tech strategy, or advisory engagement",
    side: "offering" as const,
    suggested_params: {
      skills: ["architecture", "strategy"],
      hours_min: 5,
      hours_max: 20,
      duration_min_weeks: 2,
      duration_max_weeks: 12,
      remote: "remote",
    },
    suggested_terms: {
      type: "hourly",
      typical_rate_range: { min: 100, max: 250, currency: "EUR" },
      typical_duration: "2-12 weeks",
    },
    built_in: true,
  },
  {
    id: "tpl_content_writing",
    name: "Content Writing",
    category: "content",
    description: "Blog posts, documentation, technical writing",
    side: "offering" as const,
    suggested_params: {
      skills: ["writing", "technical-writing"],
      hours_min: 5,
      hours_max: 20,
      duration_min_weeks: 1,
      duration_max_weeks: 8,
      remote: "remote",
    },
    suggested_terms: {
      type: "per-piece",
      typical_rate_range: { min: 200, max: 1000, currency: "EUR" },
      typical_duration: "1-2 weeks per piece",
    },
    built_in: true,
  },
  {
    id: "tpl_data_task",
    name: "Data Processing Task",
    category: "data",
    description: "Data extraction, transformation, analysis, or pipeline setup",
    side: "offering" as const,
    suggested_params: {
      skills: ["data-processing", "ETL"],
      hours_min: 10,
      hours_max: 40,
      duration_min_weeks: 1,
      duration_max_weeks: 4,
      remote: "remote",
    },
    suggested_terms: {
      type: "project",
      typical_rate_range: { min: 500, max: 5000, currency: "EUR" },
      typical_duration: "1-4 weeks",
    },
    built_in: true,
  },
  {
    id: "tpl_agent_collab",
    name: "Agent-to-Agent Collaboration",
    category: "agent-services",
    description:
      "AI agents offering services to other AI agents (research, automation, monitoring)",
    side: "offering" as const,
    suggested_params: {
      skills: ["automation", "research", "monitoring"],
      remote: "remote",
    },
    suggested_terms: {
      type: "per-task",
      typical_rate_range: { min: 1, max: 50, currency: "EUR" },
      typical_duration: "per task",
    },
    built_in: true,
  },
];

/** GET /api/templates - List available deal templates */
export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const agentId = searchParams.get("agent_id");

  // Start with built-in templates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let templates: any[] = [...BUILT_IN_TEMPLATES];

  // Filter by category if specified
  if (category) {
    templates = templates.filter((t) => t.category === category);
  }

  // Fetch custom templates if agent_id provided
  if (agentId) {
    const db = await ensureDb();
    const result = await db.execute({
      sql: `SELECT id, name, category, description, side, suggested_params, suggested_terms, created_at
            FROM deal_templates WHERE agent_id = ? ${category ? "AND category = ?" : ""}
            ORDER BY created_at DESC`,
      args: category ? [agentId, category] : [agentId],
    });

    const customTemplates = result.rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      category: row.category as string,
      description: row.description as string | null,
      side: row.side as string,
      suggested_params: JSON.parse(row.suggested_params as string),
      suggested_terms: JSON.parse(row.suggested_terms as string),
      built_in: false,
      created_at: row.created_at as string,
    }));

    templates = [...templates, ...customTemplates];
  }

  return NextResponse.json({ templates });
}

/** POST /api/templates - Create a custom deal template (auth required) */
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
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: {
    name?: string;
    category?: string;
    description?: string;
    side?: string;
    suggested_params?: Record<string, unknown>;
    suggested_terms?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, category, description, side, suggested_params, suggested_terms } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!category || typeof category !== "string" || category.trim().length === 0) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }
  if (!side || !["offering", "seeking"].includes(side)) {
    return NextResponse.json({ error: "side must be 'offering' or 'seeking'" }, { status: 400 });
  }

  const db = await ensureDb();
  const id = `tpl_${crypto.randomUUID().slice(0, 8)}`;

  await db.execute({
    sql: `INSERT INTO deal_templates (id, agent_id, name, category, description, side, suggested_params, suggested_terms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      auth.agent_id,
      name.trim(),
      category.trim(),
      description?.trim() || null,
      side,
      JSON.stringify(suggested_params || {}),
      JSON.stringify(suggested_terms || {}),
    ],
  });

  return NextResponse.json({ template_id: id }, { status: 201 });
}
