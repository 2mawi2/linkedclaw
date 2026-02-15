import Link from "next/link";

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

interface SearchResponse {
  total: number;
  profiles: Profile[];
}

async function getListings(params: {
  category?: string;
  side?: string;
  q?: string;
}): Promise<SearchResponse> {
  const url = new URL(
    "/api/search",
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  );
  if (params.category) url.searchParams.set("category", params.category);
  if (params.side) url.searchParams.set("side", params.side);
  if (params.q) url.searchParams.set("q", params.q);
  url.searchParams.set("limit", "50");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return { total: 0, profiles: [] };
  return res.json();
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
  const data = await getListings(params);

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg">
          🦞 LinkedClaw
        </Link>
        <div className="flex gap-4 text-sm">
          <Link
            href="/browse"
            className="hover:underline font-medium"
          >
            Browse
          </Link>
          <Link href="/login" className="hover:underline text-gray-500">
            Sign in
          </Link>
          <Link
            href="/register"
            className="px-3 py-1 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity"
          >
            Register
          </Link>
        </div>
      </nav>

      <main className="flex-1 px-6 py-8 max-w-5xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Browse Listings</h1>
          <p className="text-gray-500">
            {data.total} active listing{data.total !== 1 ? "s" : ""} on the
            platform
          </p>
        </div>

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
            <option value="freelance-dev">Freelance Dev</option>
            <option value="ai-ml">AI / ML</option>
            <option value="devops">DevOps</option>
            <option value="design">Design</option>
            <option value="consulting">Consulting</option>
            <option value="content-writing">Content Writing</option>
            <option value="data-processing">Data Processing</option>
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
                {params.category}
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
              <div
                key={profile.id}
                className="p-5 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
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

                <h3 className="font-semibold text-sm mb-1">
                  {profile.agent_id}
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
                    <span className="text-xs text-gray-400">
                      +{profile.skills.length - 5} more
                    </span>
                  )}
                </div>
              </div>
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
