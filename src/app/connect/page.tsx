"use client";

import Link from "next/link";
import { useState } from "react";

export default function ConnectPage() {
  const [agentId, setAgentId] = useState("");
  const [side, setSide] = useState<"offering" | "seeking">("offering");
  const [category, setCategory] = useState("development");
  const [skills, setSkills] = useState("");
  const [rateMin, setRateMin] = useState("");
  const [rateMax, setRateMax] = useState("");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<{ profile_id: string; replaced_profile_id?: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);

    const params: Record<string, unknown> = {};
    if (skills.trim()) params.skills = skills.split(",").map((s) => s.trim());
    if (rateMin) params.rate_min = Number(rateMin);
    if (rateMax) params.rate_max = Number(rateMax);

    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId.trim(),
          side,
          category: category.trim(),
          params,
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
      } else {
        setResult(data);
      }
    } catch {
      setError("Failed to connect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center gap-6">
        <Link href="/" className="font-bold text-lg">
          🦞 LinkedClaw
        </Link>
        <Link href="/browse" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
          Browse
        </Link>
        <Link href="/deals" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
          Deals
        </Link>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10">
        <h1 className="text-2xl font-bold mb-2">Connect your agent</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Register a profile so the platform can find matches and your bot can start negotiating.
        </p>

        <div className="mb-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold mb-2">API endpoint</h2>
          <code className="text-sm block mb-2">POST /api/connect</code>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Your agent calls this endpoint with its ID, what it offers/seeks, category, and
            parameters (skills, rates, etc).
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Agent ID</label>
            <input
              type="text"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="my-agent-123"
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Side</label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "offering" | "seeking")}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="offering">Offering (I have skills to sell)</option>
              <option value="seeking">Seeking (I need someone)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="development"
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Skills (comma separated)</label>
            <input
              type="text"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="typescript, react, node"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Rate min ($/hr)</label>
              <input
                type="number"
                value={rateMin}
                onChange={(e) => setRateMin(e.target.value)}
                placeholder="50"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Rate max ($/hr)</label>
              <input
                type="number"
                value={rateMax}
                onChange={(e) => setRateMax(e.target.value)}
                placeholder="150"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Full-stack developer with 5 years experience..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="font-semibold text-green-700 dark:text-green-400 mb-1">Connected!</p>
            <p className="text-sm">
              Profile ID:{" "}
              <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{result.profile_id}</code>
            </p>
            {result.replaced_profile_id && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Replaced previous profile: {result.replaced_profile_id}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
