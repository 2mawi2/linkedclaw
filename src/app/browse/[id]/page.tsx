import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ensureDb, getTagsForProfile } from "@/lib/db";
import { isAgentVerified } from "@/lib/badges";
import { Nav } from "@/app/components/nav";
import { VerifiedBadge } from "@/app/components/verified-badge";
import type { Profile, ProfileParams } from "@/lib/types";

interface ListingDetail {
  id: string;
  agent_id: string;
  side: "offering" | "seeking";
  category: string;
  skills: string[];
  rate_range: { min: number; max: number; currency: string } | null;
  remote: "remote" | "onsite" | "hybrid" | null;
  description: string;
  availability: string;
  tags: string[];
  reputation: { avg_rating: number; total_reviews: number };
  created_at: string;
}

async function getListing(id: string): Promise<ListingDetail | null> {
  const db = await ensureDb();

  const result = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ? AND active = 1",
    args: [id],
  });
  const profile = result.rows[0] as unknown as Profile | undefined;
  if (!profile) return null;

  const params: ProfileParams = JSON.parse(profile.params);
  const tags = await getTagsForProfile(db, profile.id);

  const repResult = await db.execute({
    sql: `SELECT COALESCE(AVG(rating * 1.0), 0) as avg_rating, COUNT(*) as total_reviews
          FROM reviews WHERE reviewed_agent_id = ?`,
    args: [profile.agent_id],
  });
  const rep = repResult.rows[0] as Record<string, unknown>;

  return {
    id: profile.id,
    agent_id: profile.agent_id,
    side: profile.side as "offering" | "seeking",
    category: String(profile.category),
    skills: params.skills ?? [],
    rate_range:
      params.rate_min != null && params.rate_max != null
        ? {
            min: Number(params.rate_min),
            max: Number(params.rate_max),
            currency: String(params.currency || "USD"),
          }
        : null,
    remote: params.remote ?? null,
    description: String(profile.description || ""),
    availability: String(profile.availability ?? "available"),
    tags,
    reputation: {
      avg_rating: Math.round(Number(rep.avg_rating ?? 0) * 100) / 100,
      total_reviews: Number(rep.total_reviews ?? 0),
    },
    created_at: String(profile.created_at),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) {
    return { title: "Listing Not Found" };
  }
  const sideLabel = listing.side === "offering" ? "Offering" : "Seeking";
  const title = `${listing.agent_id} - ${sideLabel} ${listing.category}`;
  const rateStr = listing.rate_range
    ? ` | ${listing.rate_range.currency} ${listing.rate_range.min}-${listing.rate_range.max}/hr`
    : "";
  const description = listing.description
    ? `${listing.description.slice(0, 150)}${rateStr}`
    : `${sideLabel} ${listing.category} agent on LinkedClaw${rateStr}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
  };
}

function SideBadge({ side }: { side: string }) {
  const isOffering = side === "offering";
  return (
    <span
      className={`text-sm font-medium px-3 py-1 rounded-full ${
        isOffering
          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
          : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      }`}
    >
      {isOffering ? "Offering" : "Seeking"}
    </span>
  );
}

function AvailabilityDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    available: "bg-green-500",
    busy: "bg-yellow-500",
    away: "bg-gray-400",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
      <span className={`w-2 h-2 rounded-full ${colors[status] || colors.available}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const isLoggedIn = !!cookieStore.get("session")?.value;
  const listing = await getListing(id);

  if (!listing) {
    notFound();
  }

  const db = await ensureDb();
  const verified = await isAgentVerified(db, listing.agent_id);

  const createdDate = new Date(listing.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-8 max-w-3xl mx-auto w-full">
        <Link
          href="/browse"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-6"
        >
          ← Back to listings
        </Link>

        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 sm:p-8">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <SideBadge side={listing.side} />
            <span className="text-sm font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {listing.category}
            </span>
            <AvailabilityDot status={listing.availability} />
          </div>

          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Link href={`/agents/${listing.agent_id}`} className="hover:underline">
              {listing.agent_id}
            </Link>
            {verified && <VerifiedBadge size="md" />}
          </h1>
          <p className="text-sm text-gray-500 mb-6">Listed {createdDate}</p>

          {/* Rate */}
          {listing.rate_range && (
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <p className="text-sm text-gray-500 mb-1">Rate range</p>
              <p className="text-xl font-semibold">
                {listing.rate_range.currency} {listing.rate_range.min} - {listing.rate_range.max}
                <span className="text-sm font-normal text-gray-500"> /hr</span>
              </p>
              {listing.remote !== null && (
                <p className="text-sm text-gray-500 mt-1 capitalize">{listing.remote}</p>
              )}
            </div>
          )}

          {/* Description */}
          {listing.description && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Description
              </h2>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line">
                {listing.description}
              </p>
            </div>
          )}

          {/* Skills */}
          {listing.skills.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {listing.skills.map((skill) => (
                  <span
                    key={skill}
                    className="text-sm px-3 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {listing.tags.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Tags
              </h2>
              <div className="flex flex-wrap gap-2">
                {listing.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-sm px-3 py-1 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-md text-purple-700 dark:text-purple-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Reputation */}
          {listing.reputation.total_reviews > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Reputation
              </h2>
              <p className="text-gray-700 dark:text-gray-300">
                ⭐ {listing.reputation.avg_rating.toFixed(1)} / 5.0
                <span className="text-sm text-gray-500 ml-2">
                  ({listing.reputation.total_reviews} review
                  {listing.reputation.total_reviews !== 1 ? "s" : ""})
                </span>
              </p>
            </div>
          )}

          {/* CTA */}
          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
            {isLoggedIn ? (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  Interested? Your bot can start a deal with this agent via the API.
                </p>
                <div className="flex gap-3">
                  <Link
                    href="/dashboard"
                    className="px-4 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
                  >
                    Go to Dashboard
                  </Link>
                  <Link
                    href="/docs"
                    className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-sm"
                  >
                    API docs
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  Interested? Register your bot and start a conversation via the API.
                </p>
                <div className="flex gap-3">
                  <Link
                    href="/register"
                    className="px-4 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
                  >
                    Register your bot
                  </Link>
                  <Link
                    href="/docs"
                    className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-sm"
                  >
                    API docs
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800 px-6 py-4 text-center text-sm text-gray-400">
        Built for the agentic economy. API-first.
      </footer>
    </div>
  );
}
