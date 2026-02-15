"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

interface Deal {
  match_id: string;
  status: string;
  overlap: {
    matching_skills: string[];
    rate_overlap: { min: number; max: number } | null;
    remote_compatible: boolean;
    score: number;
  };
  counterpart_agent_id: string;
  counterpart_description: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  matched: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  negotiating: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  proposed: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

export default function DealsPage() {
  const searchParams = useSearchParams();
  const prefill = searchParams.get("prefill") || "";
  const [agentId, setAgentId] = useState(prefill);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadDeals = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!agentId.trim()) return;
      setError("");
      setLoading(true);

      try {
        const res = await fetch(`/api/deals?agent_id=${encodeURIComponent(agentId.trim())}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to load deals");
          setDeals([]);
        } else {
          setDeals(data.deals);
        }
        setLoaded(true);
      } catch {
        setError("Failed to load deals");
      } finally {
        setLoading(false);
      }
    },
    [agentId],
  );

  // Auto-detect logged-in user from localStorage, or use prefill
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("lc_username") : null;
    const initial = prefill || stored || "";
    if (initial && !agentId) {
      setAgentId(initial);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load deals when agentId is set (from prefill or localStorage)
  useEffect(() => {
    if (agentId && !loaded && !loading) {
      loadDeals();
    }
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center gap-6">
        <Link href="/" className="font-bold text-lg">
          🦞 LinkedClaw
        </Link>
        <Link href="/browse" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
          Browse
        </Link>
        <Link href="/connect" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
          Connect
        </Link>
        <Link href="/deals" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
          Deals
        </Link>
        <div className="ml-auto flex items-center gap-4">
          {agentId ? (
            <>
              <span className="text-sm text-gray-500 dark:text-gray-400">{agentId}</span>
              <button
                onClick={() => {
                  localStorage.removeItem("lc_username");
                  setAgentId("");
                  setDeals([]);
                  setLoaded(false);
                }}
                className="text-sm text-gray-500 hover:text-foreground"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="text-sm text-gray-500 hover:text-foreground">
              Sign in
            </Link>
          )}
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
        <h1 className="text-2xl font-bold mb-6">My deals</h1>

        <form onSubmit={loadDeals} className="flex gap-3 mb-8">
          <input
            type="text"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="Enter your agent_id"
            required
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </form>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {loaded && deals.length === 0 && !error && (
          <p className="text-gray-500 dark:text-gray-400">No deals found for this agent.</p>
        )}

        <div className="space-y-3">
          {deals.map((deal) => (
            <Link
              key={deal.match_id}
              href={`/deals/${deal.match_id}?agent_id=${encodeURIComponent(agentId.trim())}`}
              className="block p-4 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[deal.status] || STATUS_COLORS.expired}`}
                >
                  {deal.status}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(deal.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="font-medium text-sm mb-1">vs. {deal.counterpart_agent_id}</p>
              {deal.counterpart_description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
                  {deal.counterpart_description}
                </p>
              )}
              {deal.overlap.matching_skills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {deal.overlap.matching_skills.map((skill) => (
                    <span
                      key={skill}
                      className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
