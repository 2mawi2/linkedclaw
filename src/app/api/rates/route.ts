import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";

interface ProposedTerms {
  rate?: number;
  skill?: string;
  skills?: string[];
  [key: string]: unknown;
}

interface SkillBreakdown {
  skill: string;
  median_rate: number;
  avg_rate: number;
  min_rate: number;
  max_rate: number;
  total_deals: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeStats(rates: number[]) {
  if (rates.length === 0) return null;
  const sum = rates.reduce((a, b) => a + b, 0);
  return {
    median_rate: median(rates),
    avg_rate: Math.round((sum / rates.length) * 100) / 100,
    min_rate: Math.min(...rates),
    max_rate: Math.max(...rates),
    total_deals: rates.length,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const skillFilter = searchParams.get("skill");

  if (!category || category.trim().length === 0) {
    return NextResponse.json(
      { error: "category query parameter is required" },
      { status: 400 },
    );
  }

  const db = await ensureDb();

  // Get proposal messages from approved matches in this category
  const result = await db.execute({
    sql: `SELECT m.proposed_terms, pa.params AS params_a, pb.params AS params_b
          FROM messages m
          JOIN matches ma ON ma.id = m.match_id
          JOIN profiles pa ON pa.id = ma.profile_a_id
          JOIN profiles pb ON pb.id = ma.profile_b_id
          WHERE m.message_type = 'proposal'
            AND m.proposed_terms IS NOT NULL
            AND ma.status = 'approved'
            AND (pa.category = ? OR pb.category = ?)`,
    args: [category, category],
  });

  const allRates: number[] = [];
  const bySkillMap: Record<string, number[]> = {};

  for (const row of result.rows) {
    let terms: ProposedTerms;
    try {
      terms = JSON.parse(row.proposed_terms as string);
    } catch {
      continue;
    }

    const rate = terms.rate;
    if (typeof rate !== "number" || rate <= 0) continue;

    // Collect skills from the proposal terms and profile params
    const skills = new Set<string>();
    if (terms.skill && typeof terms.skill === "string") {
      skills.add(terms.skill.toLowerCase());
    }
    if (Array.isArray(terms.skills)) {
      for (const s of terms.skills) {
        if (typeof s === "string") skills.add(s.toLowerCase());
      }
    }

    // Also gather skills from both profile params
    for (const paramsKey of ["params_a", "params_b"] as const) {
      try {
        const params = JSON.parse(row[paramsKey] as string);
        if (Array.isArray(params.skills)) {
          for (const s of params.skills) {
            if (typeof s === "string") skills.add(s.toLowerCase());
          }
        }
      } catch {
        // ignore
      }
    }

    // If skill filter is set, only include rates where the skill matches
    if (skillFilter) {
      if (!skills.has(skillFilter.toLowerCase())) continue;
    }

    allRates.push(rate);

    for (const skill of skills) {
      if (!bySkillMap[skill]) bySkillMap[skill] = [];
      bySkillMap[skill].push(rate);
    }
  }

  const stats = computeStats(allRates);

  if (!stats) {
    return NextResponse.json({
      category,
      ...(skillFilter ? { skill: skillFilter } : {}),
      median_rate: null,
      avg_rate: null,
      min_rate: null,
      max_rate: null,
      total_deals: 0,
      by_skill: [],
    });
  }

  const bySkill: SkillBreakdown[] = Object.entries(bySkillMap)
    .map(([skill, rates]) => ({
      skill,
      ...computeStats(rates)!,
    }))
    .sort((a, b) => b.total_deals - a.total_deals);

  return NextResponse.json({
    category,
    ...(skillFilter ? { skill: skillFilter } : {}),
    ...stats,
    by_skill: bySkill,
  });
}
