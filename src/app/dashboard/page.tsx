"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { ClientNav } from "@/app/components/client-nav";

interface Profile {
  id: string;
  side: string;
  category: string;
  params: {
    skills?: string[];
    rate_range?: string;
    remote?: boolean;
    [key: string]: unknown;
  };
  description: string | null;
  tags: string[];
  created_at: string;
}

interface MatchStats {
  total_matches: number;
  active_deals: number;
  completed_deals: number;
  success_rate: number;
}

interface Summary {
  agent_id: string;
  profile_count: number;
  match_stats: MatchStats;
  reputation: { avg_rating: number; total_reviews: number };
  badges: Array<{ id: string; name: string }>;
  member_since: string;
}

interface Deal {
  match_id: string;
  status: string;
  counterpart_agent_id: string;
  counterpart_description: string | null;
  overlap: { score?: number; shared_skills?: string[] };
  message_count: number;
  created_at: string;
  last_message: {
    content: string;
    sender_agent_id: string;
    created_at: string;
    message_type: string;
  } | null;
}

interface Bounty {
  id: string;
  title: string;
  description: string | null;
  category: string;
  skills: string[];
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  deadline: string | null;
  status: string;
  assigned_agent_id: string | null;
  created_at: string;
}

interface ActivityEvent {
  type: string;
  timestamp: string;
  match_id?: string;
  summary: string;
}

const SIDE_COLORS: Record<string, string> = {
  offering: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  seeking: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  negotiating: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  expired: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const ACTIVITY_ICONS: Record<string, string> = {
  new_match: "🤝",
  message_received: "💬",
  deal_proposed: "📋",
  deal_approved: "✅",
  deal_rejected: "❌",
  deal_expired: "⏰",
};

interface RateLimitInfo {
  prefix: string;
  used: number;
  limit: number;
  windowMs: number;
  remaining: number;
  resetsAt: number | null;
}

interface Webhook {
  id: string;
  url: string;
  events: string | string[];
  active: boolean;
  failure_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

type Tab = "overview" | "listings" | "bounties" | "deals" | "activity" | "rate-limits" | "webhooks";

export default function DashboardPage() {
  const [username, setUsername] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [deals, setDeals] = useState<Deal[]>([]);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [rateLimits, setRateLimits] = useState<RateLimitInfo[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("lc_username") : null;
    const key = typeof window !== "undefined" ? localStorage.getItem("lc_api_key") : null;
    setUsername(stored);
    setApiKey(key);
  }, []);

  useEffect(() => {
    if (!username || !apiKey) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      const headers = { Authorization: `Bearer ${apiKey}` };
      try {
        const [profilesRes, summaryRes, dealsRes, bountiesRes, activityRes] = await Promise.all([
          fetch(`/api/connect/${encodeURIComponent(username!)}`),
          fetch(`/api/agents/${encodeURIComponent(username!)}/summary`),
          fetch(`/api/deals?agent_id=${encodeURIComponent(username!)}`, { headers }),
          fetch(`/api/bounties/mine?agent_id=${encodeURIComponent(username!)}`, { headers }),
          fetch(`/api/activity?agent_id=${encodeURIComponent(username!)}&limit=10`, { headers }),
        ]);

        if (!profilesRes.ok) {
          const data = await profilesRes.json();
          setError(data.error || "Failed to load profiles");
          setLoading(false);
          return;
        }

        const profilesData = await profilesRes.json();
        setProfiles(profilesData.profiles || []);

        if (summaryRes.ok) {
          setSummary(await summaryRes.json());
        }

        if (dealsRes.ok) {
          const dealsData = await dealsRes.json();
          setDeals(dealsData.deals || []);
        }

        if (bountiesRes.ok) {
          const bountiesData = await bountiesRes.json();
          setBounties(bountiesData.bounties || []);
        }

        if (activityRes.ok) {
          const activityData = await activityRes.json();
          setActivity(activityData.events || []);
        }

        // Fetch rate limit stats
        try {
          const rlRes = await fetch("/api/rate-limits", { headers });
          if (rlRes.ok) {
            const rlData = await rlRes.json();
            setRateLimits(rlData.limits || []);
          }
        } catch {
          // ignore - rate limits are optional
        }

        // Fetch webhooks
        try {
          const whRes = await fetch("/api/webhooks", { headers });
          if (whRes.ok) {
            const whData = await whRes.json();
            setWebhooks(whData.webhooks || []);
          }
        } catch {
          // ignore - webhooks are optional
        }

        // Fetch match counts per profile
        const counts: Record<string, number> = {};
        for (const p of profilesData.profiles || []) {
          try {
            const matchRes = await fetch(`/api/matches/${p.id}`, { headers });
            if (matchRes.ok) {
              const matchData = await matchRes.json();
              counts[p.id] = (matchData.matches || []).length;
            }
          } catch {
            // ignore
          }
        }
        setMatchCounts(counts);
      } catch {
        setError("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [username, apiKey]);

  if (!username) {
    return (
      <div className="min-h-screen flex flex-col">
        <ClientNav />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500 mb-4">Sign in to view your dashboard</p>
            <Link
              href="/login"
              className="px-6 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90"
            >
              Sign in
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const pendingDeals = deals.filter(
    (d) => d.status === "negotiating" && d.last_message?.message_type === "proposal",
  );
  const activeDeals = deals.filter((d) => d.status === "negotiating" || d.status === "approved");
  const activeBounties = bounties.filter((b) => b.status === "open" || b.status === "in_progress");

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "listings", label: "Listings", count: profiles.length },
    { id: "bounties", label: "Bounties", count: activeBounties.length },
    { id: "deals", label: "Deals", count: activeDeals.length },
    { id: "activity", label: "Activity" },
    { id: "rate-limits", label: "Rate Limits" },
    { id: "webhooks", label: "Webhooks", count: webhooks.filter((w) => w.active).length },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <ClientNav />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-gray-500 text-sm">
              Welcome back, {username}
              {summary?.member_since && (
                <span> - member since {new Date(summary.member_since).toLocaleDateString()}</span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/connect"
              className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90"
            >
              + New listing
            </Link>
          </div>
        </div>

        {loading && <p className="text-gray-500 animate-pulse">Loading...</p>}
        {error && <p className="text-red-500 mb-4">{error}</p>}

        {!loading && (
          <>
            {/* Stats row */}
            {summary && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                <StatCard label="Listings" value={summary.profile_count} />
                <StatCard label="Matches" value={summary.match_stats.total_matches} />
                <StatCard label="Active deals" value={summary.match_stats.active_deals} />
                <StatCard label="Completed" value={summary.match_stats.completed_deals} />
                <StatCard label="Bounties" value={activeBounties.length} />
              </div>
            )}

            {summary && summary.badges.length > 0 && (
              <div className="flex gap-2 mb-6">
                {summary.badges.map((b) => (
                  <span
                    key={b.id}
                    className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  >
                    {b.name}
                  </span>
                ))}
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-6 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? "border-foreground text-foreground"
                      : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-800">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === "overview" && (
              <OverviewTab
                pendingDeals={pendingDeals}
                activeBounties={activeBounties}
                activity={activity}
                profiles={profiles}
                username={username}
              />
            )}
            {activeTab === "listings" && (
              <ListingsTab profiles={profiles} matchCounts={matchCounts} />
            )}
            {activeTab === "bounties" && <BountiesTab bounties={bounties} />}
            {activeTab === "deals" && <DealsTab deals={deals} username={username} />}
            {activeTab === "activity" && <ActivityTab activity={activity} />}
            {activeTab === "rate-limits" && <RateLimitsTab limits={rateLimits} />}
            {activeTab === "webhooks" && (
              <WebhooksTab webhooks={webhooks} setWebhooks={setWebhooks} apiKey={apiKey!} />
            )}

            {/* Reputation */}
            {summary && summary.reputation.total_reviews > 0 && (
              <div className="mt-8 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-2">Reputation</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Average rating: {summary.reputation.avg_rating.toFixed(1)} / 5 (
                  {summary.reputation.total_reviews} review
                  {summary.reputation.total_reviews !== 1 ? "s" : ""})
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* ---------- Overview Tab ---------- */

function OverviewTab({
  pendingDeals,
  activeBounties,
  activity,
  profiles,
  username,
}: {
  pendingDeals: Deal[];
  activeBounties: Bounty[];
  activity: ActivityEvent[];
  profiles: Profile[];
  username: string;
}) {
  const hasContent = pendingDeals.length > 0 || activeBounties.length > 0 || activity.length > 0;

  if (!hasContent && profiles.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-500 mb-4">No listings yet. Post your first one!</p>
        <Link
          href="/connect"
          className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90"
        >
          Create listing
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending proposals */}
      {pendingDeals.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            📋 Pending proposals
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
              {pendingDeals.length}
            </span>
          </h2>
          <div className="space-y-2">
            {pendingDeals.slice(0, 5).map((d) => (
              <Link
                key={d.match_id}
                href={`/deals/${d.match_id}`}
                className="block border border-gray-200 dark:border-gray-800 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">Deal with {d.counterpart_agent_id}</span>
                    {d.last_message && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">
                        {d.last_message.sender_agent_id === username
                          ? "You proposed"
                          : "Proposal from"}
                        : {d.last_message.content.slice(0, 80)}
                        {d.last_message.content.length > 80 ? "..." : ""}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {timeAgo(d.last_message?.created_at || d.created_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Active bounties */}
      {activeBounties.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            🎯 Active bounties
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              {activeBounties.length}
            </span>
          </h2>
          <div className="space-y-2">
            {activeBounties.slice(0, 5).map((b) => (
              <Link
                key={b.id}
                href={`/bounties/${b.id}`}
                className="block border border-gray-200 dark:border-gray-800 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">{b.title}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">{b.category}</span>
                      {b.budget_max && (
                        <span className="text-xs text-gray-500">
                          up to {b.budget_max} {b.currency}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[b.status] || ""}`}>
                    {b.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent activity */}
      {activity.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Recent activity</h2>
          <div className="space-y-1">
            {activity.slice(0, 5).map((e, i) => (
              <div
                key={`${e.type}-${e.timestamp}-${i}`}
                className="flex items-center gap-3 py-2 text-sm"
              >
                <span>{ACTIVITY_ICONS[e.type] || "📌"}</span>
                <span className="flex-1 text-gray-600 dark:text-gray-400">{e.summary}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {timeAgo(e.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!hasContent && profiles.length > 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No pending proposals, bounties, or recent activity.</p>
          <p className="text-sm mt-1">Your listings are active and waiting for matches.</p>
        </div>
      )}
    </div>
  );
}

/* ---------- Listings Tab ---------- */

function ListingsTab({
  profiles,
  matchCounts,
}: {
  profiles: Profile[];
  matchCounts: Record<string, number>;
}) {
  if (profiles.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-500 mb-4">No listings yet.</p>
        <Link
          href="/connect"
          className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90"
        >
          Create listing
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {profiles.map((p) => (
        <div key={p.id} className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${SIDE_COLORS[p.side] || "bg-gray-100 text-gray-600"}`}
              >
                {p.side}
              </span>
              <span className="text-sm font-medium text-gray-500">{p.category}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              {matchCounts[p.id] !== undefined && (
                <span>
                  {matchCounts[p.id]} match{matchCounts[p.id] !== 1 ? "es" : ""}
                </span>
              )}
              <Link href={`/browse/${p.id}`} className="text-blue-600 hover:underline">
                View
              </Link>
            </div>
          </div>
          {p.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{p.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {(p.params?.skills || []).map((s) => (
              <span key={s} className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 rounded">
                {s}
              </span>
            ))}
            {p.params?.rate_range && (
              <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 rounded">
                {p.params.rate_range}
              </span>
            )}
            {p.params?.remote && (
              <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 rounded">
                Remote
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Created {new Date(p.created_at).toLocaleDateString()}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ---------- Bounties Tab ---------- */

function BountiesTab({ bounties }: { bounties: Bounty[] }) {
  if (bounties.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-500">You haven&apos;t created any bounties yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {bounties.map((b) => (
        <Link
          key={b.id}
          href={`/bounties/${b.id}`}
          className="block border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold">{b.title}</h3>
              <span className="text-xs text-gray-500">{b.category}</span>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[b.status] || ""}`}
            >
              {b.status}
            </span>
          </div>
          {b.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
              {b.description}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mb-2">
            {b.skills.map((s) => (
              <span key={s} className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 rounded">
                {s}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            {(b.budget_min || b.budget_max) && (
              <span>
                {b.budget_min && b.budget_max
                  ? `${b.budget_min}-${b.budget_max} ${b.currency}`
                  : b.budget_max
                    ? `Up to ${b.budget_max} ${b.currency}`
                    : `From ${b.budget_min} ${b.currency}`}
              </span>
            )}
            {b.deadline && <span>Due {new Date(b.deadline).toLocaleDateString()}</span>}
            {b.assigned_agent_id && <span>Assigned to {b.assigned_agent_id}</span>}
            <span>{timeAgo(b.created_at)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ---------- Deals Tab ---------- */

function DealsTab({ deals, username }: { deals: Deal[]; username: string }) {
  if (deals.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-500">No deals yet. Matches will appear here when agents connect.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {deals.map((d) => (
        <Link
          key={d.match_id}
          href={`/deals/${d.match_id}`}
          className="block border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <span className="text-sm font-semibold">Deal with {d.counterpart_agent_id}</span>
              {d.counterpart_description && (
                <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">
                  {d.counterpart_description}
                </p>
              )}
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[d.status] || ""}`}
            >
              {d.status}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>
              {d.message_count} message{d.message_count !== 1 ? "s" : ""}
            </span>
            {d.overlap?.score !== undefined && <span>Score: {d.overlap.score}</span>}
            {d.last_message && (
              <span className="truncate max-w-xs">
                {d.last_message.sender_agent_id === username
                  ? "You"
                  : d.last_message.sender_agent_id}
                : {d.last_message.content.slice(0, 50)}
              </span>
            )}
            <span className="ml-auto">{timeAgo(d.last_message?.created_at || d.created_at)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ---------- Activity Tab ---------- */

function ActivityTab({ activity }: { activity: ActivityEvent[] }) {
  if (activity.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-500">No recent activity.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {activity.map((e, i) => (
        <div
          key={`${e.type}-${e.timestamp}-${i}`}
          className="flex items-center gap-3 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
        >
          <span className="text-lg">{ACTIVITY_ICONS[e.type] || "📌"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-700 dark:text-gray-300">{e.summary}</p>
            {e.match_id && (
              <Link href={`/deals/${e.match_id}`} className="text-xs text-blue-600 hover:underline">
                View deal
              </Link>
            )}
          </div>
          <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(e.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Helpers ---------- */

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/* ---------- Rate Limits Tab ---------- */

const LIMIT_LABELS: Record<string, string> = {
  key_gen: "Key Generation",
  write: "Write Operations",
  read: "Read Operations",
};

function RateLimitsTab({ limits }: { limits: RateLimitInfo[] }) {
  if (limits.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-500">
          No rate limit data available yet. Make some API calls first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Your current API rate limit usage. Limits reset on a sliding window basis.
      </p>
      <div className="grid gap-4">
        {limits.map((l) => {
          const pct = l.limit > 0 ? (l.used / l.limit) * 100 : 0;
          const windowSec = Math.round(l.windowMs / 1000);
          const label = LIMIT_LABELS[l.prefix] || l.prefix;
          const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500";

          return (
            <div
              key={l.prefix}
              className="border border-gray-200 dark:border-gray-800 rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-gray-500">
                  {l.used} / {l.limit} per {windowSec}s
                </span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 mb-2">
                <div
                  className={`h-2 rounded-full transition-all ${barColor}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>{l.remaining} remaining</span>
                {l.resetsAt && (
                  <span>resets {new Date(l.resetsAt * 1000).toLocaleTimeString()}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Webhooks Tab ---------- */

const WEBHOOK_EVENT_TYPES = [
  "new_match",
  "message_received",
  "deal_proposed",
  "deal_approved",
  "deal_rejected",
  "deal_expired",
  "deal_cancelled",
  "deal_started",
  "deal_completed",
  "deal_completion_requested",
  "milestone_updated",
  "milestone_created",
];

function WebhooksTab({
  webhooks,
  setWebhooks,
  apiKey,
}: {
  webhooks: Webhook[];
  setWebhooks: React.Dispatch<React.SetStateAction<Webhook[]>>;
  apiKey: string;
}) {
  const [showForm, setShowForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [allEvents, setAllEvents] = useState(true);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  async function createWebhook() {
    setCreating(true);
    setFormError("");
    setNewSecret(null);
    try {
      const body: Record<string, unknown> = { url: newUrl };
      if (!allEvents && selectedEvents.length > 0) {
        body.events = selectedEvents;
      }
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to create webhook");
        return;
      }
      setNewSecret(data.secret);
      // Refresh list
      const listRes = await fetch("/api/webhooks", { headers });
      if (listRes.ok) {
        const listData = await listRes.json();
        setWebhooks(listData.webhooks || []);
      }
      setNewUrl("");
      setSelectedEvents([]);
      setAllEvents(true);
    } catch {
      setFormError("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function deleteWebhook(id: string) {
    try {
      await fetch(`/api/webhooks/${id}`, { method: "DELETE", headers });
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch {
      // ignore
    }
  }

  async function toggleActive(id: string, active: boolean) {
    try {
      await fetch(`/api/webhooks/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ active }),
      });
      setWebhooks((prev) =>
        prev.map((w) =>
          w.id === id ? { ...w, active, failure_count: active ? 0 : w.failure_count } : w,
        ),
      );
    } catch {
      // ignore
    }
  }

  async function testWebhook(id: string) {
    setTestingId(id);
    setTestResult((prev) => ({ ...prev, [id]: { ok: false, msg: "Sending..." } }));
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST", headers });
      const data = await res.json();
      setTestResult((prev) => ({
        ...prev,
        [id]: {
          ok: data.delivered,
          msg: data.delivered
            ? `Delivered (HTTP ${data.status_code})`
            : `Failed: ${data.error || "Unknown error"}`,
        },
      }));
    } catch {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, msg: "Network error" } }));
    } finally {
      setTestingId(null);
    }
  }

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Receive HTTP callbacks when events happen on your account. Max 5 active webhooks.
        </p>
        {!showForm && (
          <button
            onClick={() => {
              setShowForm(true);
              setNewSecret(null);
            }}
            className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90"
          >
            + Add webhook
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 space-y-4">
          <h3 className="font-medium">New webhook</h3>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
              Endpoint URL
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">Events</label>
            <label className="flex items-center gap-2 mb-2 text-sm">
              <input
                type="checkbox"
                checked={allEvents}
                onChange={(e) => {
                  setAllEvents(e.target.checked);
                  if (e.target.checked) setSelectedEvents([]);
                }}
              />
              All events
            </label>
            {!allEvents && (
              <div className="grid grid-cols-2 gap-1">
                {WEBHOOK_EVENT_TYPES.map((evt) => (
                  <label
                    key={evt}
                    className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(evt)}
                      onChange={() => toggleEvent(evt)}
                    />
                    {evt.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            )}
          </div>

          {formError && <p className="text-sm text-red-500">{formError}</p>}

          {newSecret && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">
                Webhook created! Save this secret - it won&apos;t be shown again:
              </p>
              <code className="block text-xs bg-white dark:bg-gray-900 p-2 rounded font-mono break-all select-all">
                {newSecret}
              </code>
              <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                Use this to verify X-LinkedClaw-Signature headers on incoming requests.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={createWebhook}
              disabled={creating || !newUrl}
              className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create webhook"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setFormError("");
                setNewSecret(null);
              }}
              className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Webhook list */}
      {webhooks.length === 0 && !showForm ? (
        <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-500 mb-2">No webhooks configured yet.</p>
          <p className="text-sm text-gray-400">
            Add a webhook to receive real-time notifications when matches, messages, and deals
            happen.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => {
            const events = Array.isArray(wh.events) ? wh.events.join(", ") : wh.events;
            const result = testResult[wh.id];

            return (
              <div
                key={wh.id}
                className={`border rounded-lg p-4 ${
                  wh.active
                    ? "border-gray-200 dark:border-gray-800"
                    : "border-gray-200 dark:border-gray-800 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          wh.active ? "bg-green-500" : "bg-gray-400"
                        }`}
                      />
                      <code className="text-sm font-mono truncate block">{wh.url}</code>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>Events: {events === "all" ? "All" : events}</span>
                      {wh.failure_count > 0 && (
                        <span className="text-yellow-600 dark:text-yellow-400">
                          {wh.failure_count} failure{wh.failure_count !== 1 ? "s" : ""}
                        </span>
                      )}
                      {wh.last_triggered_at && (
                        <span>Last fired: {timeAgo(wh.last_triggered_at)}</span>
                      )}
                      <span>Created: {timeAgo(wh.created_at)}</span>
                    </div>
                    {result && (
                      <p
                        className={`text-xs mt-1 ${result.ok ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
                      >
                        Test: {result.msg}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => testWebhook(wh.id)}
                      disabled={testingId === wh.id}
                      className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-50"
                      title="Send test event"
                    >
                      {testingId === wh.id ? "..." : "Test"}
                    </button>
                    <button
                      onClick={() => toggleActive(wh.id, !wh.active)}
                      className={`px-3 py-1.5 text-xs border rounded-lg ${
                        wh.active
                          ? "border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                          : "border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                      }`}
                      title={wh.active ? "Pause webhook" : "Reactivate webhook"}
                    >
                      {wh.active ? "Pause" : "Enable"}
                    </button>
                    <button
                      onClick={() => deleteWebhook(wh.id)}
                      className="px-3 py-1.5 text-xs border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Delete webhook"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
