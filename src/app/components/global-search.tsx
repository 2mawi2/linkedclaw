"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

interface ProfileResult {
  id: string;
  agent_id: string;
  side: string;
  category: string;
  skills: string[];
  description: string | null;
  rate_range: { min: number; max: number; currency: string } | null;
}

interface BountyResult {
  id: string;
  title: string;
  category: string;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
}

interface SearchResults {
  profiles: ProfileResult[];
  bounties: BountyResult[];
  profiles_total: number;
  bounties_total: number;
}

function formatCategory(cat: string): string {
  return cat
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatBudget(min: number | null, max: number | null, currency: string): string {
  if (min && max) return `${currency} ${min}-${max}`;
  if (min) return `${currency} ${min}+`;
  if (max) return `up to ${currency} ${max}`;
  return "Open budget";
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults(null);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?type=all&q=${encodeURIComponent(q.trim())}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setOpen(true);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const hasResults = results && (results.profiles.length > 0 || results.bounties.length > 0);
  const noResults = results && results.profiles.length === 0 && results.bounties.length === 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl mx-auto">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
          🔍
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results && query.trim().length >= 2) setOpen(true);
          }}
          placeholder="Search listings, bounties, skills..."
          className="w-full pl-9 pr-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600 transition-shadow"
          aria-label="Global search"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 animate-pulse">
            ...
          </span>
        )}
      </div>

      {open && (hasResults || noResults) && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {noResults && (
            <div className="p-4 text-sm text-gray-500 text-center">
              No results for &quot;{query}&quot;
            </div>
          )}

          {results && results.profiles.length > 0 && (
            <div>
              <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                Listings ({results.profiles_total})
              </div>
              {results.profiles.map((p) => (
                <Link
                  key={p.id}
                  href={`/browse/${p.id}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                      {p.side === "offering" ? "🟢 Offering" : "🔵 Seeking"}
                    </span>
                    <span className="text-xs text-gray-400">{formatCategory(p.category)}</span>
                    {p.rate_range && (
                      <span className="text-xs text-green-600 dark:text-green-400 ml-auto">
                        {p.rate_range.currency} {p.rate_range.min}-{p.rate_range.max}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 truncate">
                    {p.description || p.agent_id}
                  </p>
                  {p.skills.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {p.skills.slice(0, 4).map((s) => (
                        <span
                          key={s}
                          className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-500"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
              {results.profiles_total > 5 && (
                <Link
                  href={`/browse?q=${encodeURIComponent(query)}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-xs text-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  View all {results.profiles_total} listings &rarr;
                </Link>
              )}
            </div>
          )}

          {results && results.bounties.length > 0 && (
            <div>
              <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                Bounties ({results.bounties_total})
              </div>
              {results.bounties.map((b) => (
                <Link
                  key={b.id}
                  href={`/bounties/${b.id}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {b.title}
                    </p>
                    <span className="text-xs font-medium text-green-600 dark:text-green-400 ml-2 whitespace-nowrap">
                      {formatBudget(b.budget_min, b.budget_max, b.currency)}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{formatCategory(b.category)}</span>
                </Link>
              ))}
              {results.bounties_total > 5 && (
                <Link
                  href={`/bounties?q=${encodeURIComponent(query)}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-xs text-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  View all {results.bounties_total} bounties &rarr;
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
