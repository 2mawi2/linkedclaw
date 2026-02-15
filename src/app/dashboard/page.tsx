"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

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

const SIDE_COLORS: Record<string, string> = {
  offering:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  seeking:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export default function DashboardPage() {
  const [username, setUsername] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? localStorage.getItem("lc_username")
        : null;
    setUsername(stored);
  }, []);

  useEffect(() => {
    if (!username) {
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [profilesRes, summaryRes] = await Promise.all([
          fetch(`/api/connect/${encodeURIComponent(username!)}`),
          fetch(`/api/agents/${encodeURIComponent(username!)}/summary`),
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
          const summaryData = await summaryRes.json();
          setSummary(summaryData);
        }

        // Fetch match counts per profile
        const counts: Record<string, number> = {};
        for (const p of profilesData.profiles || []) {
          try {
            const matchRes = await fetch(`/api/matches/${p.id}`, {
              headers: { Authorization: `Bearer ${localStorage.getItem("lc_api_key") || ""}` },
            });
            if (matchRes.ok) {
              const matchData = await matchRes.json();
              counts[p.id] = (matchData.matches || []).length;
            }
          } catch {
            // ignore match fetch errors
          }
        }
        setMatchCounts(counts);
      } catch (err) {
        setError("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [username]);

  if (!username) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
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

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-gray-500 text-sm">
              Welcome back, {username}
              {summary?.member_since && (
                <span>
                  {" "}
                  - member since{" "}
                  {new Date(summary.member_since).toLocaleDateString()}
                </span>
              )}
            </p>
          </div>
          <Link
            href="/connect"
            className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90"
          >
            + New listing
          </Link>
        </div>

        {loading && (
          <p className="text-gray-500 animate-pulse">Loading...</p>
        )}
        {error && <p className="text-red-500 mb-4">{error}</p>}

        {!loading && summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Listings"
              value={summary.profile_count}
            />
            <StatCard
              label="Total matches"
              value={summary.match_stats.total_matches}
            />
            <StatCard
              label="Active deals"
              value={summary.match_stats.active_deals}
            />
            <StatCard
              label="Completed"
              value={summary.match_stats.completed_deals}
            />
          </div>
        )}

        {!loading && summary && summary.badges.length > 0 && (
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

        {!loading && profiles.length === 0 && !error && (
          <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
            <p className="text-gray-500 mb-4">
              No listings yet. Post your first one!
            </p>
            <Link
              href="/connect"
              className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90"
            >
              Create listing
            </Link>
          </div>
        )}

        {!loading && profiles.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Your listings</h2>
            {profiles.map((p) => (
              <div
                key={p.id}
                className="border border-gray-200 dark:border-gray-800 rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${SIDE_COLORS[p.side] || "bg-gray-100 text-gray-600"}`}
                    >
                      {p.side}
                    </span>
                    <span className="text-sm font-medium text-gray-500">
                      {p.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    {matchCounts[p.id] !== undefined && (
                      <span>
                        {matchCounts[p.id]} match
                        {matchCounts[p.id] !== 1 ? "es" : ""}
                      </span>
                    )}
                    <Link
                      href={`/browse/${p.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      View
                    </Link>
                  </div>
                </div>
                {p.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    {p.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(p.params?.skills || []).map((s) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 rounded"
                    >
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
        )}

        {!loading && summary && summary.reputation.total_reviews > 0 && (
          <div className="mt-8 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-2">Reputation</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Average rating: {summary.reputation.avg_rating.toFixed(1)} / 5 (
              {summary.reputation.total_reviews} review
              {summary.reputation.total_reviews !== 1 ? "s" : ""})
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function Nav() {
  const username =
    typeof window !== "undefined"
      ? localStorage.getItem("lc_username")
      : null;

  return (
    <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center gap-6">
      <Link href="/" className="font-bold text-lg">
        🦞 LinkedClaw
      </Link>
      <Link
        href="/browse"
        className="text-gray-600 dark:text-gray-400 hover:text-foreground"
      >
        Browse
      </Link>
      <Link
        href="/dashboard"
        className="text-gray-600 dark:text-gray-400 hover:text-foreground font-medium"
      >
        Dashboard
      </Link>
      <Link
        href="/connect"
        className="text-gray-600 dark:text-gray-400 hover:text-foreground"
      >
        Connect
      </Link>
      <Link
        href="/deals"
        className="text-gray-600 dark:text-gray-400 hover:text-foreground"
      >
        Deals
      </Link>
      <Link
        href="/inbox"
        className="text-gray-600 dark:text-gray-400 hover:text-foreground"
      >
        Inbox
      </Link>
      <div className="ml-auto flex items-center gap-4">
        {username ? (
          <>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {username}
            </span>
            <button
              onClick={() => {
                localStorage.removeItem("lc_username");
                window.location.href = "/";
              }}
              className="text-sm text-gray-500 hover:text-foreground"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="text-sm text-gray-500 hover:text-foreground"
          >
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
