import { Client } from "@libsql/client";

export interface AgentRecommendation {
  agent_id: string;
  shared_categories: string[];
  shared_deal_partners: number;
  active_listings: number;
  relevance_score: number;
}

interface RecommendationOptions {
  limit: number;
}

/**
 * Recommend agents similar to the given agent based on:
 * 1. Category overlap (agents with listings in the same categories)
 * 2. Shared deal partners (agents who dealt with the same counterparties)
 * 3. Active listing count as tiebreaker
 */
export async function getAgentRecommendations(
  db: Client,
  agentId: string,
  opts: RecommendationOptions,
): Promise<AgentRecommendation[]> {
  const { limit } = opts;

  // Get the requesting agent's categories
  const agentCats = await db.execute({
    sql: "SELECT DISTINCT category FROM profiles WHERE agent_id = ? AND active = 1",
    args: [agentId],
  });
  const myCategories = agentCats.rows.map((r) => r.category as string);

  // Get agents the requesting agent has dealt with (via matches)
  const myPartners = await db.execute({
    sql: `SELECT DISTINCT
            CASE WHEN pa.agent_id = ? THEN pb.agent_id ELSE pa.agent_id END as partner_id
          FROM matches m
          JOIN profiles pa ON pa.id = m.profile_a_id
          JOIN profiles pb ON pb.id = m.profile_b_id
          WHERE pa.agent_id = ? OR pb.agent_id = ?`,
    args: [agentId, agentId, agentId],
  });
  const myPartnerIds = new Set(myPartners.rows.map((r) => r.partner_id as string));

  // Find candidate agents (not self, with active listings)
  const candidates = await db.execute({
    sql: `SELECT agent_id,
            GROUP_CONCAT(DISTINCT category) as categories,
            COUNT(DISTINCT id) as active_listings
          FROM profiles
          WHERE active = 1 AND agent_id != ?
          GROUP BY agent_id`,
    args: [agentId],
  });

  const recommendations: AgentRecommendation[] = [];

  for (const row of candidates.rows) {
    const candidateId = row.agent_id as string;
    const candidateCategories = (row.categories as string).split(",");
    const activeListings = Number(row.active_listings);

    // Shared categories
    const sharedCats = candidateCategories.filter((c) => myCategories.includes(c));

    // Shared deal partners: how many of MY partners has this candidate also dealt with?
    let sharedPartnerCount = 0;
    if (myPartnerIds.size > 0) {
      const candidatePartners = await db.execute({
        sql: `SELECT DISTINCT
                CASE WHEN pa.agent_id = ? THEN pb.agent_id ELSE pa.agent_id END as partner_id
              FROM matches m
              JOIN profiles pa ON pa.id = m.profile_a_id
              JOIN profiles pb ON pb.id = m.profile_b_id
              WHERE pa.agent_id = ? OR pb.agent_id = ?`,
        args: [candidateId, candidateId, candidateId],
      });
      for (const pr of candidatePartners.rows) {
        if (myPartnerIds.has(pr.partner_id as string)) sharedPartnerCount++;
      }
    }

    // Skip if no overlap at all
    if (sharedCats.length === 0 && sharedPartnerCount === 0) continue;

    // Compute relevance score
    // Category overlap: 10 points each
    // Shared partners: 15 points each
    // Active listings: 2 points each (max 10)
    const catScore = sharedCats.length * 10;
    const partnerScore = sharedPartnerCount * 15;
    const listingScore = Math.min(activeListings * 2, 10);
    const relevanceScore = catScore + partnerScore + listingScore;

    recommendations.push({
      agent_id: candidateId,
      shared_categories: sharedCats,
      shared_deal_partners: sharedPartnerCount,
      active_listings: activeListings,
      relevance_score: relevanceScore,
    });
  }

  // Sort by relevance score descending
  recommendations.sort((a, b) => b.relevance_score - a.relevance_score);

  return recommendations.slice(0, limit);
}
