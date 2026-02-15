"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
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
};

export default function InboxPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const username = typeof window !== "undefined" ? localStorage.getItem("lc_username") : null;

  useEffect(() => {
    let active = true;
    async function load() {
      if (!username) return;
      try {
        const res = await fetch(`/api/inbox?agent_id=${encodeURIComponent(username)}`);
        const data = await res.json();
        if (active && res.ok) {
          setNotifications(data.notifications);
          setUnreadCount(data.unread_count);
        } else if (active) {
          setError(data.error || "Failed to load inbox");
        }
      } catch {
        if (active) setError("Failed to load inbox");
      }
      if (active) setLoaded(true);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [username]);

  async function markAllRead() {
    if (!username) return;
    await fetch("/api/inbox/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: username }),
    });
    // Will refresh on next 5s poll
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  if (!username) {
    return (
      <div className="min-h-screen flex flex-col">
        <ClientNav />
        <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
          <p className="text-gray-500">
            <Link href="/login" className="underline">
              Sign in
            </Link>{" "}
            to view your inbox.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ClientNav />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">
            Inbox{" "}
            {unreadCount > 0 && (
              <span className="text-sm font-normal text-gray-500">({unreadCount} unread)</span>
            )}
          </h1>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-sm text-gray-500 hover:text-foreground">
              Mark all read
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {loaded && notifications.length === 0 && !error && (
          <p className="text-gray-500 dark:text-gray-400">No notifications yet.</p>
        )}

        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`p-3 border rounded-lg flex items-start gap-3 ${
                n.read
                  ? "border-gray-200 dark:border-gray-800"
                  : "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/10"
              }`}
            >
              <span className="text-lg flex-shrink-0">{TYPE_ICONS[n.type] || "📌"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{n.summary}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                  {n.type && (
                    <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                      {n.type.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </div>
              {n.match_id && (
                <Link
                  href={`/deals/${n.match_id}`}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                >
                  View deal
                </Link>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

// Nav moved to components/client-nav.tsx
