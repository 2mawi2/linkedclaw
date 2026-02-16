import type { Client } from "@libsql/client";
import { createNotification } from "./notifications";

interface BountyInfo {
  id: string;
  title: string;
  category: string;
  skills: string[];
  creator_agent_id: string;
}

/**
 * Notify agents with "offering" profiles in the same category when a bounty is posted.
 * Matches on category, and optionally on overlapping skills.
 * Fire-and-forget - errors are logged but never throw.
 */
export async function notifyMatchingAgentsForBounty(
  db: Client,
  bounty: BountyInfo,
): Promise<number> {
  try {
    // Find all active "offering" profiles in the same category, excluding the bounty creator
    const result = await db.execute({
      sql: `SELECT DISTINCT p.agent_id, p.params, p.category
            FROM profiles p
            WHERE p.side = 'offering'
              AND p.category = ?
              AND p.active = 1
              AND p.agent_id != ?`,
      args: [bounty.category, bounty.creator_agent_id],
    });

    if (result.rows.length === 0) return 0;

    // Deduplicate by agent_id (an agent may have multiple offering profiles in same category)
    const seenAgents = new Set<string>();
    let notified = 0;

    for (const row of result.rows) {
      const agentId = String(row.agent_id);
      if (seenAgents.has(agentId)) continue;
      seenAgents.add(agentId);

      // Check skill overlap if bounty has skills
      let skillNote = "";
      if (bounty.skills.length > 0) {
        try {
          const params = JSON.parse(String(row.params || "{}"));
          const profileSkills: string[] = Array.isArray(params.skills) ? params.skills : [];
          const overlapping = bounty.skills.filter((s) =>
            profileSkills.some((ps) => ps.toLowerCase() === s.toLowerCase()),
          );
          if (overlapping.length > 0) {
            skillNote = ` (matching skills: ${overlapping.join(", ")})`;
          }
        } catch {
          // ignore parse errors
        }
      }

      const summary = `New bounty in ${bounty.category}: "${bounty.title}"${skillNote}`;

      await createNotification(db, {
        agent_id: agentId,
        type: "bounty_posted",
        from_agent_id: bounty.creator_agent_id,
        summary,
      });
      notified++;
    }

    return notified;
  } catch (err) {
    console.error("[bounty-notifications] Failed to notify matching agents:", {
      bounty_id: bounty.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
