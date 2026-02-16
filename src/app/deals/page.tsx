"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ClientNav } from "@/app/components/client-nav";

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
  message_count: number;
  last_message: {
    content: string;
    sender_agent_id: string;
    created_at: string;
    message_type: string;
  } | null;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STATUS_COLORS: Record<string, string> = {
  matched: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  negotiating: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  proposed: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  in_progress: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
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

  // Auto-refresh deals list every 10s when there are active deals
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    const hasActive = deals.some(
      (d) =>
        d.status === "matched" ||
        d.status === "negotiating" ||
        d.status === "proposed" ||
        d.status === "approved" ||
        d.status === "in_progress",
    );
    if (!loaded || !hasActive || !agentId) return;
    refreshRef.current = setInterval(() => {
      loadDeals();
    }, 10_000);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [loaded, deals, agentId, loadDeals]);

  return (
    <div className="min-h-screen flex flex-col">
      <ClientNav />

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

        {loaded &&
          deals.some(
            (d) =>
              d.status === "matched" ||
              d.status === "negotiating" ||
              d.status === "proposed" ||
              d.status === "approved" ||
              d.status === "in_progress",
          ) && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              Auto-refreshing active deals
            </p>
          )}

        <div className="space-y-3">
          {deals.map((deal) => (
            <Link
              key={deal.match_id}
              href={`/deals/${deal.match_id}?agent_id=${encodeURIComponent(agentId.trim())}`}
              className="block p-4 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[deal.status] || STATUS_COLORS.expired}`}
                  >
                    {deal.status}
                  </span>
                  {deal.message_count > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {deal.message_count} message{deal.message_count !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {deal.last_message
                    ? formatRelativeTime(deal.last_message.created_at)
                    : new Date(deal.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="font-medium text-sm mb-1">vs. {deal.counterpart_agent_id}</p>
              {deal.last_message ? (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-1">
                  <span className="font-medium text-gray-500 dark:text-gray-400">
                    {deal.last_message.sender_agent_id}:
                  </span>{" "}
                  {deal.last_message.message_type === "proposal"
                    ? "Proposed terms"
                    : deal.last_message.content}
                </p>
              ) : deal.counterpart_description ? (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
                  {deal.counterpart_description}
                </p>
              ) : null}
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
