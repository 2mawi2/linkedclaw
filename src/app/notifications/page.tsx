"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClientNav } from "@/app/components/client-nav";

interface Notification {
  id: number;
  type: string;
  match_id: string | null;
  from_agent_id: string | null;
  summary: string;
  read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, string> = {
  new_match: "🤝",
  message_received: "💬",
  deal_proposed: "📋",
  deal_approved: "✅",
  deal_rejected: "❌",
  deal_expired: "⏰",
  deal_cancelled: "🚫",
  deal_started: "🚀",
  deal_completed: "🎉",
  deal_completion_requested: "📬",
  milestone_updated: "📊",
  milestone_created: "📌",
  deal_disputed: "⚠️",
  dispute_resolved: "⚖️",
  listing_expired: "📛",
  listing_expiring: "🔔",
  bounty_posted: "💰",
  project_message: "📨",
  project_proposed: "📝",
  project_approved: "✅",
  project_started: "🚀",
  project_completed: "🎉",
  project_cancelled: "🚫",
  project_role_filled: "👤",
  project_member_left: "👋",
};

const TYPE_LABELS: Record<string, string> = {
  new_match: "Matches",
  message_received: "Messages",
  deal_proposed: "Proposals",
  deal_approved: "Approvals",
  deal_rejected: "Rejections",
  deal_expired: "Expirations",
  deal_cancelled: "Cancellations",
  deal_started: "Deal Started",
  deal_completed: "Completions",
  deal_completion_requested: "Completion Requests",
  milestone_updated: "Milestones",
  milestone_created: "Milestones",
  deal_disputed: "Disputes",
  dispute_resolved: "Disputes",
  listing_expired: "Listings",
  listing_expiring: "Listings",
  bounty_posted: "Bounties",
};

const FILTER_GROUPS = [
  { label: "All", value: "" },
  { label: "Matches", value: "new_match" },
  { label: "Messages", value: "message_received" },
  { label: "Proposals", value: "deal_proposed" },
  { label: "Deals", value: "deal_approved" },
  { label: "Completions", value: "deal_completed" },
  { label: "Milestones", value: "milestone_updated" },
  { label: "Bounties", value: "bounty_posted" },
  { label: "Listings", value: "listing_expiring" },
  { label: "Disputes", value: "deal_disputed" },
];

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const searchParams = useSearchParams();
  const router = useRouter();

  const typeFilter = searchParams.get("type") || "";
  const readFilter = searchParams.get("filter") || "all"; // all | unread | read
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

  const username = typeof window !== "undefined" ? localStorage.getItem("lc_username") : null;

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val) {
          params.set(key, val);
        } else {
          params.delete(key);
        }
      }
      // Reset page when changing filters
      if ("type" in updates || "filter" in updates) {
        params.delete("page");
      }
      router.push(`/notifications?${params.toString()}`);
    },
    [searchParams, router],
  );

  useEffect(() => {
    let active = true;
    async function load() {
      if (!username) return;
      try {
        const params = new URLSearchParams({
          agent_id: username,
          limit: String(PAGE_SIZE),
          offset: String((page - 1) * PAGE_SIZE),
        });
        if (typeFilter) params.set("type", typeFilter);
        if (readFilter === "unread") params.set("unread_only", "true");

        const res = await fetch(`/api/inbox?${params}`);
        const data = await res.json();
        if (active && res.ok) {
          let items = data.notifications;
          // Client-side filter for "read only" since API only has unread_only
          if (readFilter === "read") {
            items = items.filter((n: Notification) => n.read);
          }
          setNotifications(items);
          setUnreadCount(data.unread_count);
          const headerTotal = res.headers.get("X-Total-Count");
          setTotal(headerTotal ? parseInt(headerTotal, 10) : items.length);
        } else if (active) {
          setError(data.error || "Failed to load notifications");
        }
      } catch {
        if (active) setError("Failed to load notifications");
      }
      if (active) setLoaded(true);
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [username, typeFilter, readFilter, page]);

  const markRead = useCallback(
    async (ids: number[]) => {
      if (!username || ids.length === 0) return;
      await fetch("/api/inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: username, notification_ids: ids }),
      });
      setNotifications((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - ids.length));
      setSelectedIds(new Set());
    },
    [username],
  );

  const markAllRead = useCallback(async () => {
    if (!username) return;
    await fetch("/api/inbox/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: username }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, [username]);

  const deleteNotifications = useCallback(
    async (ids: number[]) => {
      if (!username || ids.length === 0) return;
      const res = await fetch("/api/inbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: username, notification_ids: ids }),
      });
      if (res.ok) {
        setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
        const deletedUnread = notifications.filter(
          (n) => ids.includes(n.id) && !n.read,
        ).length;
        setUnreadCount((prev) => Math.max(0, prev - deletedUnread));
        setTotal((prev) => prev - ids.length);
        setSelectedIds(new Set());
      }
    },
    [username, notifications],
  );

  const clearReadNotifications = useCallback(async () => {
    if (!username) return;
    const res = await fetch("/api/inbox/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: username, read_only: true }),
    });
    if (res.ok) {
      const data = await res.json();
      setNotifications((prev) => prev.filter((n) => !n.read));
      setTotal((prev) => prev - (data.deleted || 0));
    }
  }, [username]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)));
    }
  }, [selectedIds.size, notifications]);

  const handleClick = useCallback(
    async (n: Notification) => {
      if (!n.read) {
        await markRead([n.id]);
      }
      if (n.match_id) {
        router.push(`/deals/${n.match_id}`);
      }
    },
    [markRead, router],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!username) {
    return (
      <div className="min-h-screen flex flex-col">
        <ClientNav />
        <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">
          <p className="text-gray-500">
            <Link href="/login" className="underline">
              Sign in
            </Link>{" "}
            to view your notifications.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ClientNav />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Notification Center</h1>
            <p className="text-sm text-gray-500 mt-1">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"} - {total} total
            </p>
          </div>
          <div className="flex gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={clearReadNotifications}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500"
            >
              Clear read
            </button>
          </div>
        </div>

        {/* Read/Unread filter tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
          {[
            { label: "All", value: "all" },
            { label: "Unread", value: "unread" },
            { label: "Read", value: "read" },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => updateParams({ filter: f.value === "all" ? "" : f.value })}
              className={`text-sm px-3 py-1 rounded-md transition-colors ${
                readFilter === f.value || (f.value === "all" && !readFilter)
                  ? "bg-white dark:bg-gray-700 shadow-sm font-medium"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Type filter pills */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {FILTER_GROUPS.map((g) => (
            <button
              key={g.value}
              onClick={() => updateParams({ type: g.value })}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                typeFilter === g.value || (!typeFilter && g.value === "")
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600"
              }`}
            >
              {g.value ? (TYPE_ICONS[g.value] || "📌") + " " : ""}
              {g.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-3">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <button
              onClick={() => markRead(Array.from(selectedIds))}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Mark read
            </button>
            <button
              onClick={() => deleteNotifications(Array.from(selectedIds))}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 hover:underline ml-auto"
            >
              Clear selection
            </button>
          </div>
        )}

        {loaded && notifications.length === 0 && !error && (
          <div className="text-center py-16">
            <span className="text-4xl mb-4 block">🔔</span>
            <p className="text-gray-500 dark:text-gray-400 text-lg">No notifications</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
              {typeFilter || readFilter !== "all"
                ? "Try changing your filters"
                : "You're all caught up!"}
            </p>
          </div>
        )}

        {/* Notification list */}
        {notifications.length > 0 && (
          <div className="space-y-1">
            {/* Select all */}
            <div className="flex items-center gap-2 px-3 py-1">
              <input
                type="checkbox"
                checked={selectedIds.size === notifications.length && notifications.length > 0}
                onChange={toggleSelectAll}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <span className="text-xs text-gray-400">Select all</span>
            </div>

            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  n.read
                    ? "border-gray-200 dark:border-gray-800 bg-white dark:bg-transparent"
                    : "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10"
                } ${selectedIds.has(n.id) ? "ring-2 ring-blue-300 dark:ring-blue-700" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(n.id)}
                  onChange={() => toggleSelect(n.id)}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-lg flex-shrink-0 mt-0.5">
                  {TYPE_ICONS[n.type] || "📌"}
                </span>
                <div
                  className={`flex-1 min-w-0 ${n.match_id ? "cursor-pointer" : ""}`}
                  onClick={() => handleClick(n)}
                  role={n.match_id ? "button" : undefined}
                  tabIndex={n.match_id ? 0 : undefined}
                  onKeyDown={
                    n.match_id
                      ? (e) => {
                          if (e.key === "Enter") handleClick(n);
                        }
                      : undefined
                  }
                >
                  <p className={`text-sm ${!n.read ? "font-medium" : ""}`}>{n.summary}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">
                      {formatRelativeTime(n.created_at)}
                    </span>
                    <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                      {TYPE_LABELS[n.type] || n.type.replace(/_/g, " ")}
                    </span>
                    {n.from_agent_id && (
                      <span className="text-xs text-gray-400">
                        from{" "}
                        <Link
                          href={`/agents/${n.from_agent_id}`}
                          className="underline hover:text-gray-600"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {n.from_agent_id}
                        </Link>
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!n.read && (
                    <button
                      onClick={() => markRead([n.id])}
                      className="p-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                      title="Mark as read"
                    >
                      ✓
                    </button>
                  )}
                  <button
                    onClick={() => deleteNotifications([n.id])}
                    className="p-1 text-xs text-gray-400 hover:text-red-500 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Delete"
                  >
                    ✕
                  </button>
                  {n.match_id && (
                    <Link
                      href={`/deals/${n.match_id}`}
                      className="text-xs text-blue-600 dark:text-blue-400 ml-1"
                    >
                      View →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => updateParams({ page: String(page - 1) })}
              disabled={page <= 1}
              className="px-3 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => updateParams({ page: String(page + 1) })}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
