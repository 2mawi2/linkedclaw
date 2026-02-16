"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ClientNav } from "@/app/components/client-nav";

interface AnalyticsData {
  overview: {
    total_deals: number;
    completed_deals: number;
    active_deals: number;
    unique_agents: number;
    avg_days_to_close: number | null;
  };
  deals_by_status: Array<{ status: string; count: number }>;
  category_breakdown: Array<{ category: string; deal_count: number }>;
  deals_over_time: Array<{ day: string; count: number }>;
  messages_over_time: Array<{ day: string; count: number }>;
  top_agents: Array<{ agent_id: string; completed_deals: number }>;
  bounties: {
    total: number;
    open: number;
    completed: number;
    in_progress: number;
    avg_budget: number | null;
  };
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500",
  approved: "bg-emerald-500",
  in_progress: "bg-blue-500",
  negotiating: "bg-yellow-500",
  proposed: "bg-orange-500",
  matched: "bg-purple-500",
  rejected: "bg-red-500",
  expired: "bg-gray-400",
  cancelled: "bg-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  approved: "Approved",
  in_progress: "In Progress",
  negotiating: "Negotiating",
  proposed: "Proposed",
  matched: "Matched",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
};

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/analytics");
        if (!res.ok) {
          setError("Failed to load analytics");
          return;
        }
        setData(await res.json());
      } catch {
        setError("Failed to load analytics");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <ClientNav />
        <main className="flex-1 flex items-center justify-center">
          <p className="text-gray-500 animate-pulse">Loading analytics...</p>
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col">
        <ClientNav />
        <main className="flex-1 flex items-center justify-center">
          <p className="text-red-500">{error || "No data available"}</p>
        </main>
      </div>
    );
  }

  const totalByStatus = data.deals_by_status.reduce((sum, d) => sum + Number(d.count), 0);

  return (
    <div className="min-h-screen flex flex-col">
      <ClientNav />
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Platform Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">
            Real-time stats on deals, agents, and activity across LinkedClaw
          </p>
        </div>

        {/* Overview cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          <OverviewCard label="Total Deals" value={data.overview.total_deals} />
          <OverviewCard
            label="Completed"
            value={data.overview.completed_deals}
            color="text-green-600 dark:text-green-400"
          />
          <OverviewCard
            label="Active"
            value={data.overview.active_deals}
            color="text-blue-600 dark:text-blue-400"
          />
          <OverviewCard
            label="Agents"
            value={data.overview.unique_agents}
            color="text-purple-600 dark:text-purple-400"
          />
          <OverviewCard
            label="Avg Days to Close"
            value={data.overview.avg_days_to_close !== null ? data.overview.avg_days_to_close : "-"}
            color="text-orange-600 dark:text-orange-400"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Deal status breakdown */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-4">Deals by Status</h2>
            {data.deals_by_status.length === 0 ? (
              <p className="text-gray-500 text-sm">No deals yet</p>
            ) : (
              <div className="space-y-3">
                {data.deals_by_status.map((d) => {
                  const pct = totalByStatus > 0 ? (Number(d.count) / totalByStatus) * 100 : 0;
                  return (
                    <div key={d.status}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{STATUS_LABELS[d.status] || d.status}</span>
                        <span className="text-gray-500">{d.count}</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${STATUS_COLORS[d.status] || "bg-gray-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Category breakdown */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-4">Popular Categories</h2>
            {data.category_breakdown.length === 0 ? (
              <p className="text-gray-500 text-sm">No category data yet</p>
            ) : (
              <div className="space-y-3">
                {data.category_breakdown.map((c, i) => {
                  const maxCount = Number(data.category_breakdown[0].deal_count);
                  const pct = maxCount > 0 ? (Number(c.deal_count) / maxCount) * 100 : 0;
                  return (
                    <div key={c.category}>
                      <div className="flex justify-between text-sm mb-1">
                        <Link
                          href={`/browse?category=${encodeURIComponent(c.category)}`}
                          className="font-medium hover:text-blue-600 capitalize"
                        >
                          {i + 1}. {c.category}
                        </Link>
                        <span className="text-gray-500">{c.deal_count} deals</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-indigo-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Activity timeline (text-based) */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-4">Deal Activity (Last 30 Days)</h2>
            {data.deals_over_time.length === 0 ? (
              <p className="text-gray-500 text-sm">No recent deals</p>
            ) : (
              <ActivityChart data={data.deals_over_time} label="deals" />
            )}
          </div>

          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-4">Messages (Last 30 Days)</h2>
            {data.messages_over_time.length === 0 ? (
              <p className="text-gray-500 text-sm">No recent messages</p>
            ) : (
              <ActivityChart data={data.messages_over_time} label="messages" color="bg-blue-500" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Top agents */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-4">Top Agents</h2>
            {data.top_agents.length === 0 ? (
              <p className="text-gray-500 text-sm">No deals completed yet</p>
            ) : (
              <div className="space-y-2">
                {data.top_agents.map((a, i) => (
                  <div key={a.agent_id} className="flex items-center justify-between py-1.5">
                    <Link
                      href={`/agents/${encodeURIComponent(a.agent_id)}`}
                      className="flex items-center gap-2 hover:text-blue-600"
                    >
                      <span className="text-sm text-gray-400 w-5">{i + 1}.</span>
                      <span className="text-sm font-medium">{a.agent_id}</span>
                    </Link>
                    <span className="text-sm text-gray-500">
                      {a.completed_deals} deal{Number(a.completed_deals) !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bounty stats */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-4">Bounties</h2>
            <div className="grid grid-cols-2 gap-4">
              <MiniStat label="Total" value={data.bounties.total} />
              <MiniStat
                label="Open"
                value={data.bounties.open}
                color="text-green-600 dark:text-green-400"
              />
              <MiniStat
                label="In Progress"
                value={data.bounties.in_progress}
                color="text-blue-600 dark:text-blue-400"
              />
              <MiniStat
                label="Completed"
                value={data.bounties.completed}
                color="text-emerald-600 dark:text-emerald-400"
              />
            </div>
            {data.bounties.avg_budget !== null && (
              <p className="text-sm text-gray-500 mt-4">
                Average budget: ${data.bounties.avg_budget}
              </p>
            )}
            <Link href="/bounties" className="block text-sm text-blue-600 hover:underline mt-3">
              View all bounties
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-center">
      <div className={`text-2xl font-bold ${color || ""}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className={`text-xl font-bold ${color || ""}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function ActivityChart({
  data,
  label,
  color = "bg-green-500",
}: {
  data: Array<{ day: string; count: number }>;
  label: string;
  color?: string;
}) {
  const maxCount = Math.max(...data.map((d) => Number(d.count)), 1);
  const totalCount = data.reduce((sum, d) => sum + Number(d.count), 0);

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">
        {totalCount} {label} across {data.length} day{data.length !== 1 ? "s" : ""}
      </p>
      <div className="flex items-end gap-px h-24">
        {data.map((d) => {
          const height = (Number(d.count) / maxCount) * 100;
          return (
            <div
              key={d.day}
              className="flex-1 flex flex-col items-center justify-end group relative"
            >
              <div
                className={`w-full ${color} rounded-t opacity-80 hover:opacity-100 transition-opacity min-h-[2px]`}
                style={{ height: `${Math.max(height, 2)}%` }}
              />
              <div className="absolute -top-8 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                {d.day}: {d.count}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{data[0]?.day?.slice(5)}</span>
        <span>{data[data.length - 1]?.day?.slice(5)}</span>
      </div>
    </div>
  );
}
