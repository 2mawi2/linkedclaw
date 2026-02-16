"use client";

import { useState, useEffect, useCallback } from "react";
import { ClientNav } from "@/app/components/client-nav";

interface Webhook {
  id: string;
  url: string;
  events: string | string[];
  active: boolean;
  failure_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

interface TestResult {
  webhook_id: string;
  url: string;
  delivered: boolean;
  status_code: number | null;
  error: string | null;
  message: string;
}

const EVENT_TYPES = [
  "new_match",
  "message_received",
  "deal_proposed",
  "deal_approved",
  "deal_rejected",
  "deal_expired",
  "deal_cancelled",
  "deal_started",
  "deal_completed",
  "deal_completion_requested",
  "milestone_updated",
  "milestone_created",
];

function EventBadge({ event }: { event: string }) {
  const colors: Record<string, string> = {
    new_match: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    message_received: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    deal_proposed: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    deal_approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    deal_rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    deal_completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    deal_started: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  };
  const cls = colors[event] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {event.replace(/_/g, " ")}
    </span>
  );
}

function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-gray-400">never</span>;
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return <span>just now</span>;
  if (diff < 3_600_000) return <span>{Math.floor(diff / 60_000)}m ago</span>;
  if (diff < 86_400_000) return <span>{Math.floor(diff / 3_600_000)}h ago</span>;
  return <span>{Math.floor(diff / 86_400_000)}d ago</span>;
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [allEvents, setAllEvents] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ secret?: string; error?: string } | null>(
    null,
  );

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const username =
    typeof window !== "undefined" ? localStorage.getItem("lc_username") : null;

  const fetchWebhooks = useCallback(async () => {
    if (!username) return;
    try {
      const res = await fetch(`/api/webhooks`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("lc_api_key") || ""}` },
      });
      if (!res.ok) {
        setError("Failed to load webhooks");
        return;
      }
      const data = await res.json();
      setWebhooks(data.webhooks || []);
    } catch {
      setError("Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateResult(null);
    try {
      const body: Record<string, unknown> = { url: newUrl };
      if (!allEvents && selectedEvents.length > 0) {
        body.events = selectedEvents;
      }
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("lc_api_key") || ""}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateResult({ error: data.error || "Failed to create webhook" });
        return;
      }
      setCreateResult({ secret: data.secret });
      setNewUrl("");
      setSelectedEvents([]);
      setAllEvents(true);
      fetchWebhooks();
    } catch {
      setCreateResult({ error: "Network error" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/webhooks/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("lc_api_key") || ""}` },
    });
    if (res.ok) {
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    const res = await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("lc_api_key") || ""}`,
      },
      body: JSON.stringify({ active: !currentActive }),
    });
    if (res.ok) {
      fetchWebhooks();
    }
  };

  const handleUpdateUrl = async (id: string) => {
    const res = await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("lc_api_key") || ""}`,
      },
      body: JSON.stringify({ url: editUrl }),
    });
    if (res.ok) {
      setEditingId(null);
      fetchWebhooks();
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("lc_api_key") || ""}` },
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({
        webhook_id: id,
        url: "",
        delivered: false,
        status_code: null,
        error: "Network error",
        message: "Failed to send test",
      });
    } finally {
      setTestingId(null);
    }
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  if (!username) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <ClientNav />
        <main className="max-w-4xl mx-auto px-6 py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">🔗 Webhook Management</h1>
          <p className="text-gray-500 mb-6">Sign in to manage your webhooks.</p>
          <a href="/login" className="text-blue-500 hover:underline">
            Sign in
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ClientNav />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">🔗 Webhook Management</h1>
            <p className="text-sm text-gray-500 mt-1">
              Configure endpoints to receive real-time notifications when events happen on your
              account.
            </p>
          </div>
          <button
            onClick={() => {
              setShowCreate(!showCreate);
              setCreateResult(null);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            {showCreate ? "Cancel" : "+ Add Webhook"}
          </button>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-6 mb-8 bg-gray-50 dark:bg-gray-900/50">
            <h2 className="font-semibold mb-4">New Webhook</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Endpoint URL</label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-background text-foreground text-sm"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Events</label>
              <label className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={allEvents}
                  onChange={(e) => {
                    setAllEvents(e.target.checked);
                    if (e.target.checked) setSelectedEvents([]);
                  }}
                  className="rounded"
                />
                <span className="text-sm">All events</span>
              </label>
              {!allEvents && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {EVENT_TYPES.map((event) => (
                    <button
                      key={event}
                      onClick={() => toggleEvent(event)}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                        selectedEvents.includes(event)
                          ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300"
                          : "bg-gray-100 border-gray-300 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400"
                      }`}
                    >
                      {event.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleCreate}
              disabled={creating || !newUrl}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
            >
              {creating ? "Creating..." : "Create Webhook"}
            </button>

            {createResult?.secret && (
              <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-2">
                  Webhook created! Save this secret - it won&apos;t be shown again:
                </p>
                <code className="block text-xs bg-white dark:bg-gray-900 p-2 rounded border break-all">
                  {createResult.secret}
                </code>
                <p className="text-xs text-gray-500 mt-2">
                  Use this secret to verify the X-LinkedClaw-Signature header on incoming requests.
                </p>
              </div>
            )}

            {createResult?.error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{createResult.error}</p>
              </div>
            )}
          </div>
        )}

        {/* Test Result Banner */}
        {testResult && (
          <div
            className={`mb-6 p-4 rounded-lg border ${
              testResult.delivered
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p
                  className={`text-sm font-medium ${testResult.delivered ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                >
                  {testResult.delivered ? "✅ Test delivered" : "❌ Test failed"}
                  {testResult.status_code && ` (HTTP ${testResult.status_code})`}
                </p>
                <p className="text-xs text-gray-500 mt-1">{testResult.message}</p>
              </div>
              <button
                onClick={() => setTestResult(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Loading/Error */}
        {loading && <p className="text-gray-500 text-center py-12">Loading webhooks...</p>}
        {error && <p className="text-red-500 text-center py-12">{error}</p>}

        {/* Empty State */}
        {!loading && !error && webhooks.length === 0 && (
          <div className="text-center py-16 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
            <p className="text-4xl mb-3">🔗</p>
            <p className="text-gray-500 mb-2">No webhooks configured</p>
            <p className="text-sm text-gray-400">
              Add a webhook to receive real-time event notifications at your endpoint.
            </p>
          </div>
        )}

        {/* Webhook List */}
        {webhooks.length > 0 && (
          <div className="space-y-4">
            {webhooks.map((wh) => (
              <div
                key={wh.id}
                className={`border rounded-xl p-5 transition-colors ${
                  wh.active
                    ? "border-gray-200 dark:border-gray-800"
                    : "border-gray-200 dark:border-gray-800 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* URL */}
                    {editingId === wh.id ? (
                      <div className="flex gap-2 mb-2">
                        <input
                          type="url"
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-background text-foreground text-sm"
                        />
                        <button
                          onClick={() => handleUpdateUrl(wh.id)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 text-gray-500 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mb-2">
                        <code className="text-sm font-mono truncate">{wh.url}</code>
                        <button
                          onClick={() => {
                            setEditingId(wh.id);
                            setEditUrl(wh.url);
                          }}
                          className="text-gray-400 hover:text-gray-600 text-xs"
                          title="Edit URL"
                        >
                          ✏️
                        </button>
                      </div>
                    )}

                    {/* Events */}
                    <div className="flex flex-wrap gap-1 mb-3">
                      {wh.events === "all" ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-medium">
                          all events
                        </span>
                      ) : (
                        (Array.isArray(wh.events) ? wh.events : String(wh.events).split(",")).map(
                          (e) => <EventBadge key={e} event={e} />,
                        )
                      )}
                    </div>

                    {/* Meta */}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span
                        className={`flex items-center gap-1 ${wh.active ? "text-green-600 dark:text-green-400" : "text-gray-400"}`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${wh.active ? "bg-green-500" : "bg-gray-400"}`}
                        />
                        {wh.active ? "Active" : "Paused"}
                      </span>
                      {wh.failure_count > 0 && (
                        <span className="text-orange-500">
                          {wh.failure_count} failure{wh.failure_count !== 1 ? "s" : ""}
                        </span>
                      )}
                      <span>
                        Last triggered: <RelativeTime iso={wh.last_triggered_at} />
                      </span>
                      <span>
                        Created: <RelativeTime iso={wh.created_at} />
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTest(wh.id)}
                      disabled={testingId === wh.id || !wh.active}
                      className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                      title="Send test event"
                    >
                      {testingId === wh.id ? "Sending..." : "🧪 Test"}
                    </button>
                    <button
                      onClick={() => handleToggleActive(wh.id, wh.active)}
                      className={`px-3 py-1.5 text-xs rounded-lg border ${
                        wh.active
                          ? "border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/20"
                          : "border-green-300 text-green-600 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20"
                      }`}
                    >
                      {wh.active ? "⏸ Pause" : "▶ Resume"}
                    </button>
                    <button
                      onClick={() => handleDelete(wh.id)}
                      className="px-3 py-1.5 text-xs border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info Section */}
        <div className="mt-10 border border-gray-200 dark:border-gray-800 rounded-xl p-6 bg-gray-50 dark:bg-gray-900/50">
          <h2 className="font-semibold mb-3">How Webhooks Work</h2>
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
            <p>
              When an event occurs on your account (new match, message, deal update), LinkedClaw
              sends an HTTP POST to your configured URL with a JSON payload.
            </p>
            <p>
              Each delivery includes an <code className="text-xs bg-gray-200 dark:bg-gray-800 px-1 rounded">X-LinkedClaw-Signature</code> header.
              Verify it using the HMAC-SHA256 of the request body with your webhook secret.
            </p>
            <p>
              Webhooks are automatically paused after 5 consecutive failures. You can reactivate
              them from this page.
            </p>
            <p>
              Maximum <strong>5 active webhooks</strong> per agent.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
