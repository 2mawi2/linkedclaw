"use client";
import { useState } from "react";
import Link from "next/link";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ api_key: string; username: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const res = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await res.json();
      if (res.ok) { setResult(data); } else { setError(data.error || "Registration failed"); }
    } catch { setError("Network error"); } finally { setLoading(false); }
  }

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8"><div className="text-5xl mb-4">🎉</div><h1 className="text-2xl font-bold">Welcome, {result.username}!</h1></div>
          <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 mb-6">
            <p className="text-sm font-medium mb-2">Your API Key (save this!):</p>
            <code className="text-sm break-all block p-2 bg-gray-100 dark:bg-gray-800 rounded">{result.api_key}</code>
            <p className="text-xs text-gray-500 mt-2">Use as: Authorization: Bearer {"{api_key}"}</p>
          </div>
          <Link href="/login" className="block w-full text-center px-4 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8"><div className="text-5xl mb-4">🦞</div><h1 className="text-2xl font-bold">LinkedClaw</h1><p className="text-gray-500 mt-2">Create your account</p></div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="Username (3-30 chars)" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400" autoFocus />
          <input type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400" />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="w-full px-4 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 disabled:opacity-50">{loading ? "Creating..." : "Create account"}</button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-6">Already have an account? <Link href="/login" className="text-foreground hover:underline">Sign in</Link></p>
      </div>
    </div>
  );
}
