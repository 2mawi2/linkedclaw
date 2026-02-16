import type { Client } from "@libsql/client";

export interface DigestItem {
  type: "new_listing" | "new_bounty" | "deal_update";
  id: string;
  agent_id?: string;
  title?: string;
  category: string;
  description?: string;
  skills?: string[];
  created_at: string;
  /** Extra context depending on type */
  meta?: Record<string, unknown>;
}

export interface DigestResult {
  agent_id: string;
  since: string;
  until: string;
  new_listings: DigestItem[];
  new_bounties: DigestItem[];
  deal_updates: DigestItem[];
  summary: string;
}

/**
 * Generate a personalized digest for an agent.
 * Returns new listings + bounties matching their skills/category, plus deal activity.
 */
export async function generateDigest(
  db: Client,
  agentId: string,
  since: string,
): Promise<DigestResult> {
  const until = new Date().toISOString().replace("T", " ").slice(0, 19);

  // Get agent's profiles to know their categories and skills
  const profilesResult = await db.execute({
    sql: "SELECT id, category, params, side FROM profiles WHERE agent_id = ? AND active = 1",
    args: [agentId],
  });

  const agentCategories = new Set<string>();
  const agentSkills = new Set<string>();

  for (const row of profilesResult.rows) {
    agentCategories.add(row.category as string);
    try {
      const params = JSON.parse((row.params as string) || "{}");
      if (Array.isArray(params.skills)) {
        for (const s of params.skills) {
          agentSkills.add(String(s).toLowerCase());
        }
      }
    } catch {
      // skip invalid params
    }
  }

  // Fetch new listings (not from this agent) since the given time
  const listingsResult = await db.execute({
    sql: `SELECT id, agent_id, side, category, description, params, created_at
          FROM profiles
          WHERE created_at > ? AND agent_id != ? AND active = 1
          ORDER BY created_at DESC
          LIMIT 50`,
    args: [since, agentId],
  });

  const newListings: DigestItem[] = [];
  for (const row of listingsResult.rows) {
    const category = row.category as string;
    let skills: string[] = [];
    try {
      const params = JSON.parse((row.params as string) || "{}");
      skills = Array.isArray(params.skills) ? params.skills : [];
    } catch {
      // skip
    }

    // Include if category matches or skills overlap (agent must have profiles)
    const categoryMatch = agentCategories.has(category);
    const skillsLower = skills.map((s) => s.toLowerCase());
    const skillMatch = skillsLower.some((s) => agentSkills.has(s));

    if (categoryMatch || skillMatch) {
      newListings.push({
        type: "new_listing",
        id: row.id as string,
        agent_id: row.agent_id as string,
        category,
        description: row.description as string,
        skills,
        created_at: row.created_at as string,
        meta: { side: row.side as string },
      });
    }
  }

  // Fetch new bounties since the given time
  const bountiesResult = await db.execute({
    sql: `SELECT id, creator_agent_id, title, description, category, skills, budget_min, budget_max, currency, status, created_at
          FROM bounties
          WHERE created_at > ? AND creator_agent_id != ? AND status = 'open'
          ORDER BY created_at DESC
          LIMIT 50`,
    args: [since, agentId],
  });

  const newBounties: DigestItem[] = [];
  for (const row of bountiesResult.rows) {
    const category = row.category as string;
    let skills: string[] = [];
    try {
      skills = JSON.parse((row.skills as string) || "[]");
    } catch {
      // skip
    }

    const categoryMatch = agentCategories.has(category);
    const skillsLower = skills.map((s) => s.toLowerCase());
    const skillMatch = skillsLower.some((s) => agentSkills.has(s));

    if (categoryMatch || skillMatch) {
      newBounties.push({
        type: "new_bounty",
        id: row.id as string,
        agent_id: row.creator_agent_id as string,
        title: row.title as string,
        category,
        description: row.description as string,
        skills,
        created_at: row.created_at as string,
        meta: {
          budget_min: row.budget_min,
          budget_max: row.budget_max,
          currency: row.currency,
        },
      });
    }
  }

  // Fetch deal updates for this agent's matches
  const dealsResult = await db.execute({
    sql: `SELECT m.id, m.status, m.created_at, m.overlap_summary,
                 pa.agent_id as agent_a, pb.agent_id as agent_b, pa.category
          FROM matches m
          JOIN profiles pa ON m.profile_a_id = pa.id
          JOIN profiles pb ON m.profile_b_id = pb.id
          WHERE (pa.agent_id = ? OR pb.agent_id = ?)
            AND m.created_at > ?
          ORDER BY m.created_at DESC
          LIMIT 20`,
    args: [agentId, agentId, since],
  });

  const dealUpdates: DigestItem[] = dealsResult.rows.map((row) => ({
    type: "deal_update" as const,
    id: row.id as string,
    category: row.category as string,
    description: row.overlap_summary as string,
    created_at: row.created_at as string,
    meta: {
      status: row.status,
      counterpart:
        (row.agent_a as string) === agentId
          ? (row.agent_b as string)
          : (row.agent_a as string),
    },
  }));

  // Build summary text
  const parts: string[] = [];
  if (newListings.length > 0) {
    parts.push(`${newListings.length} new listing${newListings.length > 1 ? "s" : ""} matching your skills`);
  }
  if (newBounties.length > 0) {
    parts.push(`${newBounties.length} new bount${newBounties.length > 1 ? "ies" : "y"} in your categories`);
  }
  if (dealUpdates.length > 0) {
    parts.push(`${dealUpdates.length} deal update${dealUpdates.length > 1 ? "s" : ""}`);
  }
  const summary = parts.length > 0 ? parts.join(", ") + "." : "No new activity matching your profile.";

  return {
    agent_id: agentId,
    since,
    until,
    new_listings: newListings,
    new_bounties: newBounties,
    deal_updates: dealUpdates,
    summary,
  };
}
