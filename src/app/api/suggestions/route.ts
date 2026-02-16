import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { suggestFromDescription } from "@/lib/category-suggestions";

/**
 * POST /api/suggestions - Suggest categories and skills from a description
 *
 * Public endpoint (no auth required). Agents can use this before creating
 * a listing to get relevant category and skill suggestions.
 *
 * Body: { "description": "I build React apps with TypeScript..." }
 * Optional: { "max_categories": 3, "max_skills": 8 }
 *
 * Returns:
 * {
 *   "categories": [{ "category": "freelance-dev", "confidence": 0.8, "label": "Freelance Development" }],
 *   "skills": [{ "skill": "React", "confidence": 0.9, "matched_term": "react" }]
 * }
 */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "suggestions");
  if (rl) return rl;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const description = body.description;
  if (!description || typeof description !== "string" || description.trim().length === 0) {
    return NextResponse.json(
      { error: "description is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  if (description.length > 5000) {
    return NextResponse.json(
      { error: "description must be 5000 characters or less" },
      { status: 400 },
    );
  }

  const maxCategories =
    typeof body.max_categories === "number" ? Math.min(Math.max(1, body.max_categories), 10) : 3;
  const maxSkills =
    typeof body.max_skills === "number" ? Math.min(Math.max(1, body.max_skills), 20) : 8;

  const result = suggestFromDescription(description, maxCategories, maxSkills);

  return NextResponse.json(result);
}
