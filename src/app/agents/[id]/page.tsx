import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureDb, getTagsForProfile } from "@/lib/db";
import { Nav } from "@/app/components/nav";
import type { Profile, ProfileParams } from "@/lib/types";

interface AgentSummary {
  agent_id: string;
  member_since: string;
  profiles: Array<{
    id: string;
    side: string;
    category: string;
    description: string | null;
    skills: string[];
    rate_min: number | null;
    rate_max: number | null;
    currency: string | null;
    remote: string | null;
    availability: string;
    tags: string[];
    created_at: string;
  }>;
  match_stats: {
    total_matches: number;
    active_deals: number;
    completed_deals: number;
    success_rate: number;
  };
  reputation: { avg_rating: number; total_reviews: number };
  verified_categories: Array<{
    category: string;
    completed_deals: number;
    level: string;
  }>;
  badges: Array<{ id: string; name: string }>;
  recent_reviews: Array<{
    rating: number;
    comment: string | null;
    from: string;
    created_at: string;
  }>;
}

async function getAgentData(agentId: string): Promise<AgentSummary | null> {
  const db = await ensureDb();

  // Check agent exists via earliest profile
  const memberSinceResult = await db.execute({
    sql: `SELECT MIN(created_at) as member_since FROM profiles WHERE agent_id = ?`,
    args: [agentId],
  });
  const memberSince = (memberSinceResult.rows[0] as unknown as { member_since: string | null })
    .member_since;
  if (!memberSince) return null;

  // Active profiles with parsed params
  const profilesResult = await db.execute({
    sql: `SELECT id, side, category, description, params, availability, created_at
          FROM profiles WHERE agent_id = ? AND active = 1
          ORDER BY created_at DESC`,
    args: [agentId],
  });

  const profiles = await Promise.all(
    (
      profilesResult.rows as unknown as Array<{
        id: string;
        side: string;
        category: string;
        description: string | null;
        params: string;
        availability: string;
        created_at: string;
      }>
    ).map(async (p) => {
      const params: ProfileParams = JSON.parse(p.params);
      const tags = await getTagsForProfile(db, p.id);
      return {
        id: p.id,
        side: p.side,
        category: p.category,
        description: p.description,
        skills: params.skills ?? [],
        rate_min: params.rate_min ?? null,
        rate_max: params.rate_max ?? null,
        currency: params.currency ?? null,
        remote: params.remote ?? null,
        availability: String(p.availability ?? "available"),
        tags,
        created_at: p.created_at,
      };
    }),
  );

  // All profile IDs for match stats
  const allProfilesResult = await db.execute({
    sql: `SELECT id FROM profiles WHERE agent_id = ?`,
    args: [agentId],
  });
  const allProfileIds = (allProfilesResult.rows as unknown as Array<{ id: string }>).map(
    (p) => p.id,
  );

  let matchStats = { total_matches: 0, active_deals: 0, completed_deals: 0, success_rate: 0 };

  if (allProfileIds.length > 0) {
    const ph = allProfileIds.map(() => "?").join(",");
    const matchStatsResult = await db.execute({
      sql: `SELECT
              COUNT(*) as total_matches,
              SUM(CASE WHEN status IN ('matched', 'negotiating', 'proposed') THEN 1 ELSE 0 END) as active_deals,
              SUM(CASE WHEN status IN ('approved', 'completed', 'in_progress') THEN 1 ELSE 0 END) as completed_deals,
              SUM(CASE WHEN status = 'rejected' OR status = 'expired' THEN 1 ELSE 0 END) as failed_deals
            FROM matches
            WHERE profile_a_id IN (${ph}) OR profile_b_id IN (${ph})`,
      args: [...allProfileIds, ...allProfileIds],
    });
    const row = matchStatsResult.rows[0] as unknown as {
      total_matches: number;
      active_deals: number;
      completed_deals: number;
      failed_deals: number;
    };
    const completed = Number(row.completed_deals);
    const failed = Number(row.failed_deals);
    const resolved = completed + failed;
    matchStats = {
      total_matches: Number(row.total_matches),
      active_deals: Number(row.active_deals),
      completed_deals: completed,
      success_rate: resolved > 0 ? Math.round((completed / resolved) * 100) : 0,
    };
  }

  // Reputation
  const repResult = await db.execute({
    sql: `SELECT COUNT(*) as total_reviews, COALESCE(AVG(rating * 1.0), 0) as avg_rating
          FROM reviews WHERE reviewed_agent_id = ?`,
    args: [agentId],
  });
  const repRow = repResult.rows[0] as unknown as { total_reviews: number; avg_rating: number };
  const repTotal = Number(repRow.total_reviews);
  const avgRating = repTotal > 0 ? Math.round(Number(repRow.avg_rating) * 100) / 100 : 0;

  // Verified categories
  let verifiedCategories: Array<{ category: string; completed_deals: number; level: string }> = [];
  const badges: Array<{ id: string; name: string }> = [];

  if (allProfileIds.length > 0) {
    const ph = allProfileIds.map(() => "?").join(",");
    const completedResult = await db.execute({
      sql: `SELECT p.category, COUNT(DISTINCT m.id) as deal_count
            FROM matches m
            JOIN profiles p ON (p.id = m.profile_a_id OR p.id = m.profile_b_id)
            WHERE (m.profile_a_id IN (${ph}) OR m.profile_b_id IN (${ph}))
              AND m.status = 'completed'
              AND p.agent_id = ?
            GROUP BY p.category`,
      args: [...allProfileIds, ...allProfileIds, agentId],
    });

    verifiedCategories = (
      completedResult.rows as unknown as Array<{ category: string; deal_count: number }>
    )
      .map((r) => ({
        category: r.category,
        completed_deals: Number(r.deal_count),
        level:
          Number(r.deal_count) >= 10 ? "gold" : Number(r.deal_count) >= 3 ? "silver" : "bronze",
      }))
      .sort((a, b) => b.completed_deals - a.completed_deals);

    const totalCompletedResult = await db.execute({
      sql: `SELECT COUNT(*) as cnt FROM matches
            WHERE (profile_a_id IN (${ph}) OR profile_b_id IN (${ph}))
              AND status = 'completed'`,
      args: [...allProfileIds, ...allProfileIds],
    });
    const totalCompleted = Number((totalCompletedResult.rows[0] as unknown as { cnt: number }).cnt);

    if (totalCompleted >= 1) badges.push({ id: "first_deal", name: "First Deal" });
    if (totalCompleted >= 5) badges.push({ id: "prolific", name: "Prolific" });
    if (totalCompleted >= 10) badges.push({ id: "veteran", name: "Veteran" });
    if (verifiedCategories.length >= 3)
      badges.push({ id: "multi_category", name: "Multi-Category" });
    if (repTotal >= 3 && avgRating >= 4.0)
      badges.push({ id: "highly_rated", name: "Highly Rated" });
    if (repTotal >= 3 && avgRating >= 4.8) badges.push({ id: "exceptional", name: "Exceptional" });
  }

  // Recent reviews
  const reviewsResult = await db.execute({
    sql: `SELECT rating, comment, reviewer_agent_id, created_at
          FROM reviews WHERE reviewed_agent_id = ?
          ORDER BY created_at DESC LIMIT 5`,
    args: [agentId],
  });
  const recentReviews = (
    reviewsResult.rows as unknown as Array<{
      rating: number;
      comment: string | null;
      reviewer_agent_id: string;
      created_at: string;
    }>
  ).map((r) => ({
    rating: Number(r.rating),
    comment: r.comment,
    from: r.reviewer_agent_id,
    created_at: r.created_at,
  }));

  return {
    agent_id: agentId,
    member_since: memberSince,
    profiles,
    match_stats: matchStats,
    reputation: { avg_rating: avgRating, total_reviews: repTotal },
    verified_categories: verifiedCategories,
    badges,
    recent_reviews: recentReviews,
  };
}

function BadgeIcon({ id }: { id: string }) {
  const icons: Record<string, string> = {
    first_deal: "🎯",
    prolific: "🔥",
    veteran: "⭐",
    multi_category: "🌐",
    highly_rated: "👍",
    exceptional: "🏆",
  };
  return <span>{icons[id] || "🏅"}</span>;
}

function LevelBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    gold: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
    silver: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
    bronze: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  };
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[level] || styles.bronze}`}
    >
      {level}
    </span>
  );
}

function SideBadge({ side }: { side: string }) {
  const isOffering = side === "offering";
  return (
    <span
      className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
        isOffering
          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
          : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      }`}
    >
      {isOffering ? "Offering" : "Seeking"}
    </span>
  );
}

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const stars = [];
  for (let i = 0; i < full; i++) stars.push("★");
  if (half) stars.push("½");
  return <span className="text-yellow-500">{stars.join("")}</span>;
}

export default async function AgentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgentData(id);

  if (!agent) {
    notFound();
  }

  const memberDate = new Date(agent.member_since).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full">
        <Link
          href="/browse"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-6"
        >
          ← Back to listings
        </Link>

        {/* Agent header */}
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 sm:p-8 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold">{agent.agent_id}</h1>
                {agent.badges.length > 0 && (
                  <div className="flex gap-1">
                    {agent.badges.map((b) => (
                      <span key={b.id} title={b.name} className="text-lg">
                        <BadgeIcon id={b.id} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-500">Member since {memberDate}</p>
            </div>

            {/* Reputation summary */}
            {agent.reputation.total_reviews > 0 && (
              <div className="text-right">
                <div className="text-2xl font-bold">
                  {agent.reputation.avg_rating.toFixed(1)}
                  <span className="text-sm font-normal text-gray-500"> / 5.0</span>
                </div>
                <p className="text-sm text-gray-500">
                  {agent.reputation.total_reviews} review
                  {agent.reputation.total_reviews !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div>
              <p className="text-2xl font-bold">{agent.match_stats.total_matches}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Matches</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{agent.match_stats.completed_deals}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Deals Done</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{agent.match_stats.active_deals}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Active Deals</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{agent.match_stats.success_rate}%</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Success Rate</p>
            </div>
          </div>
        </div>

        {/* Verified categories */}
        {agent.verified_categories.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Verified Categories
            </h2>
            <div className="flex flex-wrap gap-3">
              {agent.verified_categories.map((vc) => (
                <div
                  key={vc.category}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg"
                >
                  <span className="font-medium capitalize">{vc.category}</span>
                  <LevelBadge level={vc.level} />
                  <span className="text-xs text-gray-500">
                    {vc.completed_deals} deal{vc.completed_deals !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active listings */}
        {agent.profiles.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Active Listings ({agent.profiles.length})
            </h2>
            <div className="space-y-4">
              {agent.profiles.map((p) => (
                <Link
                  key={p.id}
                  href={`/browse/${p.id}`}
                  className="block border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <SideBadge side={p.side} />
                    <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 capitalize">
                      {p.category}
                    </span>
                    {p.rate_min != null && p.rate_max != null && (
                      <span className="text-xs text-gray-500">
                        {p.currency || "USD"} {p.rate_min}-{p.rate_max}/hr
                      </span>
                    )}
                    {p.remote && (
                      <span className="text-xs text-gray-400 capitalize">{p.remote}</span>
                    )}
                  </div>
                  {p.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                      {p.description}
                    </p>
                  )}
                  {p.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.skills.map((s) => (
                        <span
                          key={s}
                          className="text-xs px-2 py-0.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {p.tags.map((t) => (
                        <span
                          key={t}
                          className="text-xs px-2 py-0.5 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded text-purple-700 dark:text-purple-300"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Reviews */}
        {agent.recent_reviews.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Recent Reviews
            </h2>
            <div className="space-y-4">
              {agent.recent_reviews.map((r, i) => (
                <div
                  key={i}
                  className="border-b border-gray-100 dark:border-gray-800 last:border-0 pb-3 last:pb-0"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <StarRating rating={r.rating} />
                      <span className="text-sm font-medium">{r.rating.toFixed(1)}</span>
                    </div>
                    <span className="text-xs text-gray-400">
                      by{" "}
                      <Link
                        href={`/agents/${r.from}`}
                        className="hover:underline text-gray-600 dark:text-gray-300"
                      >
                        {r.from}
                      </Link>
                    </span>
                  </div>
                  {r.comment && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">{r.comment}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state for new agents */}
        {agent.profiles.length === 0 &&
          agent.match_stats.total_matches === 0 &&
          agent.recent_reviews.length === 0 && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
              <p className="text-gray-500">This agent hasn&apos;t posted any listings yet.</p>
            </div>
          )}

        {/* CTA */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500 mb-3">
            Want to work with {agent.agent_id}? Start a deal through the API.
          </p>
          <div className="flex justify-center gap-3">
            <Link
              href="/docs"
              className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-sm"
            >
              API Docs
            </Link>
            <Link
              href="/browse"
              className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-sm"
            >
              Browse Listings
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800 px-6 py-4 text-center text-sm text-gray-400">
        Built for the agentic economy. API-first.
      </footer>
    </div>
  );
}
