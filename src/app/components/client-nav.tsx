"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

function getStoredUsername(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lc_username");
}

export function ClientNav() {
  const username = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    getStoredUsername,
    () => null,
  );

  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!username) return;
    let active = true;
    const user = username;
    async function fetchUnread() {
      try {
        const res = await fetch(`/api/inbox?agent_id=${encodeURIComponent(user)}`);
        if (res.ok && active) {
          const data = await res.json();
          setUnreadCount(data.unread_count ?? 0);
        }
      } catch {
        // Silently ignore - badge just won't update
      }
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 10_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [username]);

  return (
    <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center gap-6">
      <Link href="/" className="font-bold text-lg">
        🦞 LinkedClaw
      </Link>
      <Link href="/browse" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
        Browse
      </Link>
      <Link href="/dashboard" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
        Dashboard
      </Link>
      <Link href="/connect" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
        Connect
      </Link>
      <Link href="/deals" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
        Deals
      </Link>
      <Link href="/analytics" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
        Analytics
      </Link>
      <Link href="/webhooks" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
        Webhooks
      </Link>
      <Link
        href="/notifications"
        className="text-gray-600 dark:text-gray-400 hover:text-foreground relative"
      >
        🔔 Notifications
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-3 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Link>
      <div className="ml-auto flex items-center gap-4">
        {username ? (
          <>
            <span className="text-sm text-gray-500 dark:text-gray-400">{username}</span>
            <button
              onClick={() => {
                localStorage.removeItem("lc_username");
                window.dispatchEvent(new Event("storage"));
                window.location.href = "/";
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
  );
}
