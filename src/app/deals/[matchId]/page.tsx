"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "next/navigation";

interface ProfileInfo {
  id: string;
  agent_id: string;
  side: string;
  category: string;
  description: string | null;
  params: Record<string, unknown>;
}

interface MatchInfo {
  id: string;
  status: string;
  overlap: {
    matching_skills: string[];
    rate_overlap: { min: number; max: number } | null;
    remote_compatible: boolean;
    score: number;
  };
  created_at: string;
  profiles: { a: ProfileInfo; b: ProfileInfo };
}

interface MessageInfo {
  id: number;
  sender_agent_id: string;
  content: string;
  message_type: string;
  proposed_terms: Record<string, unknown> | null;
  created_at: string;
}

interface ApprovalInfo {
  agent_id: string;
  approved: boolean;
  created_at: string;
}

interface DealData {
  match: MatchInfo;
  messages: MessageInfo[];
  approvals: ApprovalInfo[];
}

const STATUS_COLORS: Record<string, string> = {
  matched: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  negotiating: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  proposed: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

export default function DealDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const matchId = params.matchId as string;
  const queryAgentId = searchParams.get("agent_id") || "";
  const [agentId, setAgentId] = useState(queryAgentId);

  const [data, setData] = useState<DealData | null>(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [approvalResult, setApprovalResult] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastActivityRef = useRef(Date.now());

  // Auto-detect logged-in user from localStorage if not in URL
  useEffect(() => {
    if (!agentId) {
      const stored = typeof window !== "undefined" ? localStorage.getItem("lc_username") : null;
      if (stored) setAgentId(stored);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDeal = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${matchId}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to load deal");
        return;
      }
      setData(json);
    } catch {
      setError("Failed to load deal");
    }
  }, [matchId]);

  useEffect(() => {
    fetchDeal();
  }, [fetchDeal]);

  // Adaptive polling: 1.5s when recently active, 5s when idle (>30s no interaction)
  useEffect(() => {
    if (!data) return;
    const status = data.match.status;
    if (status === "approved" || status === "rejected" || status === "expired") return;

    let timer: ReturnType<typeof setTimeout>;
    function schedulePoll() {
      const idleMs = Date.now() - lastActivityRef.current;
      const interval = idleMs < 30_000 ? 1500 : 5000;
      timer = setTimeout(() => {
        fetchDeal().then(schedulePoll);
      }, interval);
    }
    schedulePoll();
    return () => clearTimeout(timer);
  }, [data, fetchDeal]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages.length]);

  async function handleApproval(approved: boolean) {
    if (!agentId) {
      setApprovalResult("No agent_id provided. Add ?agent_id=xxx to the URL.");
      return;
    }
    setApproving(true);
    setApprovalResult("");
    try {
      const res = await fetch(`/api/deals/${matchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, approved }),
      });
      const json = await res.json();
      if (!res.ok) {
        setApprovalResult(json.error || "Failed");
      } else {
        setApprovalResult(json.message);
        fetchDeal();
      }
    } catch {
      setApprovalResult("Failed to submit approval");
    } finally {
      setApproving(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!agentId || !newMessage.trim()) return;
    const content = newMessage.trim();
    setSending(true);
    setSendError("");

    lastActivityRef.current = Date.now();
    // Optimistic update: show message immediately
    const optimisticMsg: MessageInfo = {
      id: Date.now(),
      sender_agent_id: agentId,
      content,
      message_type: "negotiation",
      proposed_terms: null,
      created_at: new Date().toISOString(),
    };
    setData((prev) =>
      prev ? { ...prev, messages: [...prev.messages, optimisticMsg] } : prev,
    );
    setNewMessage("");

    try {
      const res = await fetch(`/api/deals/${matchId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          content,
          message_type: "negotiation",
        }),
      });
      if (res.ok) {
        fetchDeal(); // Sync with server to get real message ID
      } else {
        const json = await res.json().catch(() => ({}));
        setSendError(json.error || "Failed to send message");
        // Roll back optimistic update
        setData((prev) =>
          prev
            ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticMsg.id) }
            : prev,
        );
        setNewMessage(content);
      }
    } catch {
      setSendError("Failed to send message");
      setData((prev) =>
        prev
          ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticMsg.id) }
          : prev,
      );
      setNewMessage(content);
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
            {error}
          </div>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
          <p className="text-gray-500">Loading...</p>
        </main>
      </div>
    );
  }

  const { match, messages, approvals } = data;
  const isActive =
    match.status === "negotiating" || match.status === "matched" || match.status === "proposed";

  // Find the latest proposal
  const latestProposal = [...messages].reverse().find((m) => m.message_type === "proposal");

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/deals" className="text-gray-500 hover:text-foreground">
            &larr; Back
          </Link>
          <h1 className="text-xl font-bold">Deal</h1>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[match.status] || STATUS_COLORS.expired}`}
          >
            {match.status}
          </span>
        </div>

        {/* Match info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <ProfileCard profile={match.profiles.a} label="Side A" />
          <ProfileCard profile={match.profiles.b} label="Side B" />
        </div>

        {/* Overlap */}
        <div className="mb-6 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold mb-2">
            Match overlap (score: {match.overlap.score})
          </h3>
          <div className="flex flex-wrap gap-2 text-sm">
            {match.overlap.matching_skills.map((s) => (
              <span key={s} className="bg-gray-200 dark:bg-gray-800 px-2 py-0.5 rounded text-xs">
                {s}
              </span>
            ))}
            {match.overlap.rate_overlap && (
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Rate: ${match.overlap.rate_overlap.min}-${match.overlap.rate_overlap.max}/hr
              </span>
            )}
            {match.overlap.remote_compatible && (
              <span className="text-xs text-green-600 dark:text-green-400">Remote OK</span>
            )}
          </div>
        </div>

        {/* Chat transcript */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3">Messages</h3>
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg max-h-[32rem] overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-950">
            {messages.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                No messages yet. Waiting for agents to start negotiating...
              </p>
            )}
            {messages.map((msg, idx) => {
              const isMe = msg.sender_agent_id === agentId;
              const isProposal = msg.message_type === "proposal";
              const isSystem = msg.message_type === "system";
              const prevMsg = idx > 0 ? messages[idx - 1] : null;

              // Day separator
              const msgDate = new Date(msg.created_at).toDateString();
              const prevDate = prevMsg ? new Date(prevMsg.created_at).toDateString() : null;
              const showDaySep = prevDate !== null && msgDate !== prevDate;

              // Round separator: show before a proposal (if there are messages before it)
              const showRoundSep = isProposal && idx > 0;

              return (
                <div key={msg.id}>
                  {showDaySep && (
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                        {new Date(msg.created_at).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                    </div>
                  )}

                  {showRoundSep && !showDaySep && (
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-purple-200 dark:bg-purple-800" />
                      <span className="text-xs text-purple-400 dark:text-purple-500 whitespace-nowrap">
                        Proposal
                      </span>
                      <div className="flex-1 h-px bg-purple-200 dark:bg-purple-800" />
                    </div>
                  )}

                  {isSystem ? (
                    <div className="text-center py-1">
                      <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-900 px-3 py-1 rounded-full">
                        {msg.content}
                      </span>
                    </div>
                  ) : isProposal ? (
                    <div className="mx-auto max-w-[90%] border-2 border-purple-300 dark:border-purple-700 rounded-lg p-3 bg-purple-50 dark:bg-purple-900/10">
                      <p className="text-xs text-purple-600 dark:text-purple-400 mb-1 flex items-center gap-1">
                        <span className="font-semibold">{msg.sender_agent_id}</span>
                        <span className="opacity-60">proposed terms</span>
                        <span className="ml-auto opacity-60">
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </p>
                      <p className="text-sm whitespace-pre-wrap mb-2">{msg.content}</p>
                      {msg.proposed_terms && (
                        <pre className="text-xs p-2 rounded bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-800 overflow-x-auto">
                          {JSON.stringify(msg.proposed_terms, null, 2)}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          isMe
                            ? "bg-foreground text-background"
                            : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
                        }`}
                      >
                        <p
                          className={`text-xs mb-1 ${isMe ? "opacity-70" : "text-gray-500 dark:text-gray-400"}`}
                        >
                          {msg.sender_agent_id}
                          {msg.message_type !== "negotiation" && (
                            <span className="ml-1 font-medium">[{msg.message_type}]</span>
                          )}
                          <span className="ml-2 opacity-60">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </p>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          {isActive && agentId && (
            <form onSubmit={handleSendMessage} className="mt-3 flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm"
              />
              <button
                type="submit"
                disabled={sending || !newMessage.trim()}
                className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Send
              </button>
            </form>
          )}
          {sendError && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{sendError}</p>}
          {isActive && (
            <p className="text-xs text-gray-400 mt-1">Live updates enabled</p>
          )}
        </div>

        {/* Proposed terms + approval */}
        {match.status === "proposed" && latestProposal && (
          <div className="mb-6 p-4 border-2 border-purple-300 dark:border-purple-700 rounded-lg bg-purple-50 dark:bg-purple-900/10">
            <h3 className="font-semibold mb-2">Proposed terms</h3>
            {latestProposal.proposed_terms && (
              <pre className="text-sm bg-white dark:bg-gray-900 p-3 rounded mb-3 overflow-x-auto">
                {JSON.stringify(latestProposal.proposed_terms, null, 2)}
              </pre>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {latestProposal.content}
            </p>
            {agentId && (
              <div className="flex gap-3">
                <button
                  onClick={() => handleApproval(true)}
                  disabled={approving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleApproval(false)}
                  disabled={approving}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        )}

        {/* Approval result */}
        {approvalResult && (
          <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
            {approvalResult}
          </div>
        )}

        {/* Approved state */}
        {match.status === "approved" && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <h3 className="font-semibold text-green-700 dark:text-green-400 mb-2">
              Deal approved!
            </h3>
            <p className="text-sm mb-2">
              Both parties have approved. Here are the agent IDs for direct contact:
            </p>
            <div className="text-sm space-y-1">
              <p>
                Agent A:{" "}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                  {match.profiles.a.agent_id}
                </code>
              </p>
              <p>
                Agent B:{" "}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                  {match.profiles.b.agent_id}
                </code>
              </p>
            </div>
          </div>
        )}

        {/* Approvals list */}
        {approvals.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold mb-2">Approvals</h3>
            <div className="space-y-1">
              {approvals.map((a, i) => (
                <div key={i} className="text-sm flex items-center gap-2">
                  <span
                    className={
                      a.approved
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {a.approved ? "Approved" : "Rejected"}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">by {a.agent_id}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function getStoredUsername(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lc_username");
}

function Nav() {
  const username = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    getStoredUsername,
    () => null,
  );

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
      <Link href="/inbox" className="text-gray-600 dark:text-gray-400 hover:text-foreground">
        Inbox
      </Link>
      <div className="ml-auto flex items-center gap-4">
        {username ? (
          <>
            <span className="text-sm text-gray-500 dark:text-gray-400">{username}</span>
            <button
              onClick={() => {
                localStorage.removeItem("lc_username");
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

function ProfileCard({ profile, label }: { profile: ProfileInfo; label: string }) {
  return (
    <div className="p-3 border border-gray-200 dark:border-gray-800 rounded-lg">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
        {label} ({profile.side})
      </p>
      <p className="font-medium text-sm">{profile.agent_id}</p>
      <p className="text-xs text-gray-600 dark:text-gray-400">{profile.category}</p>
      {profile.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{profile.description}</p>
      )}
    </div>
  );
}
