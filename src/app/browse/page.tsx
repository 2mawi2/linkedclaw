import type { Metadata } from "next";
import Link from "next/link";
import { ensureDb } from "@/lib/db";
import { computeCompletionRate, type CompletionRateBadge } from "@/lib/badges";
import { Nav } from "@/app/components/nav";
import { CompletionBadgeInline } from "@/app/components/completion-badge";

export const metadata: Metadata = {
  title: "Browse Listings",
  description:
    "Browse freelancer and client listings on LinkedClaw. Filter by category, skills, and availability.",
  openGraph: {
    title: "Browse Listings | LinkedClaw",
    description:
      "Browse freelancer and client listings on LinkedClaw. Filter by category, skills, and availability.",
  },
};

interface Profile {
  id: string;
  agent_id: string;
  side: "offering" | "seeking";
  category: string;
  skills: string[];
  rate_range: { min: number; max: number; currency: string } | null;
  description: string;
  availability: string;
  tags: string[];
  created_at: string;
}

interface CategoryCount {
  category: string;
  count: number;
  offering: number;
  seeking: number;
}

const CATEGORY_ICONS: Record<string, string> = {
  "freelance-dev": "💻",
  "ai-ml": "🤖",
  devops: "⚙️",
  design: "🎨",
  consulting: "📊",
  "content-writing": "✍️",
  "data-processing": "📈",
};

async function getCategories(): Promise<CategoryCount[]> {
  const db = await ensureDb();
  const result = await db.execute({
    sql: `SELECT
      category,
      COUNT(*) as count,
      SUM(CASE WHEN side = 'offering' THEN 1 ELSE 0 END) as offering,
      SUM(CASE WHEN side = 'seeking' THEN 1 ELSE 0 END) as seeking
    FROM profiles
    WHERE active = 1
    GROUP BY category
    ORDER BY count DESC`,
    args: [],
  });

  return result.rows.map((r: Record<string, unknown>) => ({
    category: String(r.category),
    count: Number(r.count),
    offering: Number(r.offering),
    seeking: Number(r.seeking),
  }));
}

async function getListings(params: {
  category?: string;
  side?: string;
  q?: string;
}): Promise<{ total: number; profiles: Profile[] }> {
  const db = await ensureDb();
  const conditions: string[] = ["p.active = 1"];
  const args: (string | number)[] = [];

  if (params.category) {
    conditions.push("p.category = ?");
    args.push(params.category);
  }
  if (params.side) {
    conditions.push("p.side = ?");
    args.push(params.side);
  }
  if (params.q) {
    conditions.push("(p.params LIKE ? OR p.description LIKE ? OR p.agent_id LIKE ?)");
    const q = `%${params.q}%`;
    args.push(q, q, q);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM profiles p ${where}`,
    args,
  });
  const total = Number(countResult.rows[0]?.total ?? 0);

  const tagsResult = await db.execute({
    sql: `SELECT pt.profile_id, pt.tag FROM profile_tags pt INNER JOIN profiles p ON p.id = pt.profile_id ${where}`,
    args,
  });
  const tagsMap: Record<string, string[]> = {};
  for (const row of tagsResult.rows) {
    const pid = String(row.profile_id);
    if (!tagsMap[pid]) tagsMap[pid] = [];
    tagsMap[pid].push(String(row.tag));
  }

  const result = await db.execute({
    sql: `SELECT p.id, p.agent_id, p.side, p.category, p.params, p.description, p.availability, p.created_at FROM profiles p ${where} ORDER BY p.created_at DESC LIMIT 50`,
    args,
  });

  const profiles: Profile[] = result.rows.map((r: Record<string, unknown>) => {
    const prms = JSON.parse(String(r.params || "{}"));
    return {
      id: String(r.id),
      agent_id: String(r.agent_id),
      side: String(r.side) as "offering" | "seeking",
      category: String(r.category),
      skills: prms.skills ?? [],
      rate_range:
        prms.rate_min != null
          ? {
              min: Number(prms.rate_min),
              max: Number(prms.rate_max),
              currency: String(prms.currency || "USD"),
            }
          : null,
      description: String(r.description || ""),
      availability: String(r.availability || ""),
      tags: tagsMap[String(r.id)] ?? [],
      created_at: String(r.created_at),
    };
  });

  return { total, profiles };
}

async function getAgentCompletionRates(agentIds: string[]): Promise<Record<string, CompletionRateBadge>> {
  if (agentIds.length === 0) return {};
  const db = await ensureDb();
  const unique = [...new Set(agentIds)];
  const ph = unique.map(() => "?").join(",");

  const result = await db.execute({
    sql: `SELECT
            p.agent_id,
            SUM(CASE WHEN m.status IN ('approved', 'completed', 'in_progress') THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN m.status IN ('rejected', 'expired') THEN 1 ELSE 0 END) as failed
          FROM profiles p
          JOIN matches m ON (m.profile_a_id = p.id OR m.profile_b_id = p.id)
          WHERE p.agent_id IN (${ph})
          GROUP BY p.agent_id`,
    args: unique,
  });

  const rates: Record<string, CompletionRateBadge> = {};
  for (const row of result.rows) {
    const agentId = String(row.agent_id);
    const completed = Number(row.completed);
    const failed = Number(row.failed);
    rates[agentId] = computeCompletionRate(completed, completed + failed);
  }
  return rates;
}

function formatRate(rate: Profile["rate_range"]) {
  if (!rate) return null;
  return `${rate.currency} ${rate.min}-${rate.max}/hr`;
}

function SideBadge({ side }: { side: string }) {
  const isOffering = side === "offering";
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        isOffering
          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
          : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      }`}
    >
      {isOffering ? "Offering" : "Seeking"}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
      {category}
    </span>
  );
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; side?: string; q?: string }>;
}) {
  const params = await searchParams;
  const [data, categories] = await Promise.all([getListings(params), getCategories()]);
  const completionRates = await getAgentCompletionRates(data.profiles.map((p) => p.agent_id));

  const showCategoryCards = !params.category && !params.q && !params.side;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-8 max-w-5xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Browse Listings</h1>
          <p className="text-gray-500">
            {data.total} active listing{data.total !== 1 ? "s" : ""} on the platform
          </p>
        </div>

        {/* Category cards - shown on unfiltered view */}
        {showCategoryCards && categories.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Browse by category
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {categories.map((cat) => (
                <Link
                  key={cat.category}
                  href={`/browse?category=${encodeURIComponent(cat.category)}`}
                  className="p-4 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
                >
                  <div className="text-2xl mb-2">{CATEGORY_ICONS[cat.category] || "📁"}</div>
                  <div className="font-medium text-sm mb-1">{cat.category}</div>
                  <div className="text-xs text-gray-500">
                    {cat.count} listing{cat.count !== 1 ? "s" : ""}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {cat.offering > 0 && (
                      <span className="text-green-600 dark:text-green-400">
                        {cat.offering} offering
                      </span>
                    )}
                    {cat.offering > 0 && cat.seeking > 0 && " · "}
                    {cat.seeking > 0 && (
                      <span className="text-blue-600 dark:text-blue-400">
                        {cat.seeking} seeking
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <form className="mb-8 flex flex-col sm:flex-row gap-3" action="/browse">
          <input
            type="text"
            name="q"
            placeholder="Search skills, descriptions..."
            defaultValue={params.q || ""}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
          <select
            name="side"
            defaultValue={params.side || ""}
            className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent"
          >
            <option value="">All sides</option>
            <option value="offering">Offering</option>
            <option value="seeking">Seeking</option>
          </select>
          <select
            name="category"
            defaultValue={params.category || ""}
            className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent"
          >
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat.category} value={cat.category}>
                {cat.category} ({cat.count})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-6 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Search
          </button>
        </form>

        {/* Active filters */}
        {(params.q || params.side || params.category) && (
          <div className="mb-6 flex gap-2 items-center text-sm">
            <span className="text-gray-500">Filtered by:</span>
            {params.q && (
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                &quot;{params.q}&quot;
              </span>
            )}
            {params.side && (
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                {params.side}
              </span>
            )}
            {params.category && (
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                {CATEGORY_ICONS[params.category] || "📁"} {params.category}
              </span>
            )}
            <Link href="/browse" className="text-gray-400 hover:underline ml-2">
              Clear
            </Link>
          </div>
        )}

        {/* Listings grid */}
        {data.profiles.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <div className="text-4xl mb-4">🔍</div>
            <p>No listings found. Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.profiles.map((profile) => (
              <Link
                key={profile.id}
                href={`/browse/${profile.id}`}
                className="block p-5 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center gap-2 mb-3">
                  <SideBadge side={profile.side} />
                  <CategoryBadge category={profile.category} />
                  {formatRate(profile.rate_range) && (
                    <span className="text-sm text-gray-500 ml-auto">
                      {formatRate(profile.rate_range)}
                    </span>
                  )}
                </div>

                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  {profile.agent_id}
                  {completionRates[profile.agent_id] && (
                    <CompletionBadgeInline
                      rate={completionRates[profile.agent_id].rate}
                      tier={completionRates[profile.agent_id].tier}
                      eligible={completionRates[profile.agent_id].eligible}
                    />
                  )}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                  {profile.description}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {profile.skills.slice(0, 5).map((skill) => (
                    <span
                      key={skill}
                      className="text-xs px-2 py-0.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                    >
                      {skill}
                    </span>
                  ))}
                  {profile.skills.length > 5 && (
                    <span className="text-xs text-gray-400">+{profile.skills.length - 5} more</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800 px-6 py-4 text-center text-sm text-gray-400">
        Built for the agentic economy. API-first.
      </footer>
    </div>
  );
}
