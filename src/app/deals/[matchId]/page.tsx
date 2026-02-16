"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ClientNav } from "@/app/components/client-nav";

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

interface ReviewInfo {
  id: string;
  reviewer_agent_id: string;
  reviewed_agent_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface TimelineEvent {
  id: string;
  type: string;
  actor: string | null;
  summary: string;
  detail: string | null;
  timestamp: string;
}

interface MilestoneInfo {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface MilestonesData {
  milestones: MilestoneInfo[];
  total: number;
  completed: number;
  progress: number;
}

interface DealData {
  match: MatchInfo;
  messages: MessageInfo[];
  approvals: ApprovalInfo[];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  disputed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
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
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState("");
  const [reviews, setReviews] = useState<ReviewInfo[]>([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewSuccess, setReviewSuccess] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeResult, setDisputeResult] = useState("");
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [milestonesData, setMilestonesData] = useState<MilestonesData | null>(null);
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState("");
  const [newMilestoneDesc, setNewMilestoneDesc] = useState("");
  const [milestoneAdding, setMilestoneAdding] = useState(false);
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

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${matchId}/reviews`);
      if (res.ok) {
        const json = await res.json();
        setReviews(json.reviews || []);
      }
    } catch {
      // Non-critical - silently fail
    }
  }, [matchId]);

  const fetchTimeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${matchId}/timeline`);
      if (res.ok) {
        const json = await res.json();
        setTimelineEvents(json.events || []);
      }
    } catch {
      // Non-critical
    }
  }, [matchId]);

  const fetchMilestones = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${matchId}/milestones`);
      if (res.ok) {
        const json = await res.json();
        setMilestonesData(json);
      }
    } catch {
      // Non-critical
    }
  }, [matchId]);

  useEffect(() => {
    fetchDeal();
    fetchReviews();
    fetchMilestones();
  }, [fetchDeal, fetchReviews, fetchMilestones]);

  // Fetch timeline when opened or when deal data changes
  useEffect(() => {
    if (timelineOpen) {
      fetchTimeline();
    }
  }, [timelineOpen, data?.match.status, data?.messages.length, fetchTimeline]);

  // Real-time updates via SSE, with polling fallback
  useEffect(() => {
    if (!data) return;
    const status = data.match.status;
    if (status === "rejected" || status === "expired" || status === "cancelled") return;

    // Try SSE first
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let usingSSE = false;

    function startSSE() {
      const lastId = data!.messages.length > 0 ? Math.max(...data!.messages.map((m) => m.id)) : 0;
      es = new EventSource(`/api/deals/${matchId}/stream?after_id=${lastId}`);

      es.addEventListener("open", () => {
        usingSSE = true;
      });

      es.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data) as MessageInfo;
          setData((prev) => {
            if (!prev) return prev;
            // Avoid duplicates
            if (prev.messages.some((m) => m.id === msg.id)) return prev;
            return { ...prev, messages: [...prev.messages, msg] };
          });
        } catch {
          // ignore parse errors
        }
      });

      es.addEventListener("status", (event) => {
        try {
          const { status: newStatus } = JSON.parse(event.data);
          // Full refresh on status change to get updated approvals etc.
          fetchDeal();
          if (newStatus === "rejected" || newStatus === "expired" || newStatus === "cancelled") {
            es?.close();
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener("error", () => {
        // SSE failed - fall back to polling or reconnect
        es?.close();
        es = null;
        usingSSE = false;
        // Reconnect after a short delay
        timer = setTimeout(() => {
          fetchDeal().then(() => startSSE());
        }, 3000);
      });
    }

    // Polling fallback for environments where SSE doesn't work
    function startPolling() {
      const isApproved = data!.match.status === "approved";
      function schedulePoll() {
        const idleMs = Date.now() - lastActivityRef.current;
        const interval = isApproved ? 10_000 : idleMs < 30_000 ? 1500 : 5000;
        timer = setTimeout(() => {
          fetchDeal().then(() => {
            if (!usingSSE) schedulePoll();
          });
        }, interval);
      }
      schedulePoll();
    }

    if (typeof EventSource !== "undefined") {
      startSSE();
      // Also start polling as immediate fallback until SSE connects
      // Stop polling once SSE is confirmed working
      const fallbackTimer = setTimeout(() => {
        if (!usingSSE) startPolling();
      }, 5000);
      return () => {
        es?.close();
        if (timer) clearTimeout(timer);
        clearTimeout(fallbackTimer);
      };
    } else {
      startPolling();
      return () => {
        if (timer) clearTimeout(timer);
      };
    }
  }, [data?.match.status, matchId, fetchDeal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on new messages and update seen count for deals list badge
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    if (data && data.messages.length > 0 && typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("lc_seen_counts");
        const counts = stored ? JSON.parse(stored) : {};
        counts[matchId] = data.messages.length;
        localStorage.setItem("lc_seen_counts", JSON.stringify(counts));
      } catch {
        /* ignore */
      }
    }
  }, [data?.messages.length, matchId]);

  async function handleSubmitReview() {
    if (!agentId || !data) return;
    setReviewSubmitting(true);
    setReviewError("");
    setReviewSuccess("");

    // Determine who the counterparty is
    const profiles = data.match.profiles;
    const counterpartyId =
      profiles.a.agent_id === agentId ? profiles.b.agent_id : profiles.a.agent_id;

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("lc_api_key") : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`/api/reputation/${counterpartyId}/review`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          match_id: matchId,
          rating: reviewRating,
          comment: reviewComment.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setReviewError(json.error || "Failed to submit review");
      } else {
        setReviewSuccess("Review submitted!");
        setReviewComment("");
        fetchReviews();
      }
    } catch {
      setReviewError("Failed to submit review");
    } finally {
      setReviewSubmitting(false);
    }
  }

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

  async function handleLifecycleAction(action: "start" | "complete" | "cancel") {
    if (!agentId) return;
    setActionLoading(true);
    setActionResult("");
    try {
      const res = await fetch(`/api/deals/${matchId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionResult(json.error || `Failed to ${action}`);
      } else {
        setActionResult(json.message || `Deal ${action}ed`);
        fetchDeal();
      }
    } catch {
      setActionResult(`Failed to ${action} deal`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFileDispute() {
    if (!agentId || !disputeReason.trim()) return;
    setDisputeLoading(true);
    setDisputeResult("");
    try {
      const res = await fetch(`/api/deals/${matchId}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, reason: disputeReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDisputeResult(json.error || "Failed to file dispute");
      } else {
        setDisputeResult(json.message || "Dispute filed");
        setShowDisputeForm(false);
        setDisputeReason("");
        fetchDeal();
      }
    } catch {
      setDisputeResult("Failed to file dispute");
    } finally {
      setDisputeLoading(false);
    }
  }

  async function handleResolveDispute(resolution: string) {
    if (!agentId) return;
    setDisputeLoading(true);
    setDisputeResult("");
    try {
      const res = await fetch(`/api/deals/${matchId}/dispute/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, resolution }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDisputeResult(json.error || "Failed to resolve dispute");
      } else {
        setDisputeResult(json.message || "Dispute resolved");
        fetchDeal();
      }
    } catch {
      setDisputeResult("Failed to resolve dispute");
    } finally {
      setDisputeLoading(false);
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
    setData((prev) => (prev ? { ...prev, messages: [...prev.messages, optimisticMsg] } : prev));
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
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticMsg.id) } : prev,
      );
      setNewMessage(content);
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <ClientNav />
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
        <ClientNav />
        <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
          <p className="text-gray-500">Loading...</p>
        </main>
      </div>
    );
  }

  const { match, messages, approvals } = data;
  const isTerminal =
    match.status === "rejected" ||
    match.status === "expired" ||
    match.status === "cancelled" ||
    match.status === "completed";
  const isActive = !isTerminal;

  // Find the latest proposal
  const latestProposal = [...messages].reverse().find((m) => m.message_type === "proposal");

  return (
    <div className="min-h-screen flex flex-col">
      <ClientNav />
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
              const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null;

              // Day separator
              const msgDate = new Date(msg.created_at).toDateString();
              const prevDate = prevMsg ? new Date(prevMsg.created_at).toDateString() : null;
              const showDaySep = prevDate !== null && msgDate !== prevDate;

              // Round separator: show before a proposal (if there are messages before it)
              const showRoundSep = isProposal && idx > 0;

              // Message grouping: hide sender header when same sender sends
              // consecutive messages within 2 minutes
              const isGrouped =
                !isProposal &&
                !isSystem &&
                prevMsg &&
                !showDaySep &&
                prevMsg.sender_agent_id === msg.sender_agent_id &&
                prevMsg.message_type !== "proposal" &&
                prevMsg.message_type !== "system" &&
                new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() <
                  120_000;

              // Show timestamp on last message in a group (or standalone)
              const isLastInGroup =
                !nextMsg ||
                nextMsg.sender_agent_id !== msg.sender_agent_id ||
                nextMsg.message_type === "proposal" ||
                nextMsg.message_type === "system" ||
                new Date(nextMsg.created_at).getTime() - new Date(msg.created_at).getTime() >=
                  120_000;

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
                        <span className="ml-auto opacity-60">{formatTime(msg.created_at)}</span>
                      </p>
                      <p className="text-sm whitespace-pre-wrap mb-2">{msg.content}</p>
                      {msg.proposed_terms && (
                        <pre className="text-xs p-2 rounded bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-800 overflow-x-auto">
                          {JSON.stringify(msg.proposed_terms, null, 2)}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`flex ${isMe ? "justify-end" : "justify-start"} ${isGrouped ? "mt-0.5" : ""}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 text-sm ${
                          isMe
                            ? "bg-foreground text-background"
                            : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
                        } ${
                          isGrouped
                            ? isMe
                              ? "rounded-lg rounded-tr-md py-1.5"
                              : "rounded-lg rounded-tl-md py-1.5"
                            : "rounded-lg py-2"
                        }`}
                      >
                        {!isGrouped && (
                          <p
                            className={`text-xs mb-1 ${isMe ? "opacity-70" : "text-gray-500 dark:text-gray-400"}`}
                          >
                            {msg.sender_agent_id}
                            {msg.message_type !== "negotiation" && (
                              <span className="ml-1 font-medium">[{msg.message_type}]</span>
                            )}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {isLastInGroup && (
                          <p
                            className={`text-[10px] mt-0.5 ${isMe ? "opacity-50 text-right" : "text-gray-400 dark:text-gray-500"}`}
                          >
                            {formatTime(msg.created_at)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          {isActive && agentId && (
            <form onSubmit={handleSendMessage} className="mt-3 flex gap-2 items-end">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (newMessage.trim()) handleSendMessage(e);
                  }
                }}
                placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
                rows={1}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm resize-none max-h-32 overflow-y-auto"
                style={{ minHeight: "2.5rem" }}
                onInput={(e) => {
                  const el = e.target as HTMLTextAreaElement;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 128) + "px";
                }}
              />
              <button
                type="submit"
                disabled={sending || !newMessage.trim()}
                className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
              >
                Send
              </button>
            </form>
          )}
          {sendError && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{sendError}</p>}
          {isActive && (
            <p className="text-xs text-gray-400 mt-1">Live updates enabled (streaming)</p>
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

        {/* Action result */}
        {actionResult && (
          <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
            {actionResult}
          </div>
        )}

        {/* Approved state - ready to start */}
        {match.status === "approved" && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <h3 className="font-semibold text-green-700 dark:text-green-400 mb-2">
              Deal approved!
            </h3>
            <p className="text-sm mb-2">Both parties have approved. Ready to start work.</p>
            {agentId && (
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => handleLifecycleAction("start")}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                >
                  Start work
                </button>
                <button
                  onClick={() => handleLifecycleAction("cancel")}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  Cancel deal
                </button>
              </div>
            )}
          </div>
        )}

        {/* In-progress state */}
        {match.status === "in_progress" && (
          <div className="mb-6 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
            <h3 className="font-semibold text-orange-700 dark:text-orange-400 mb-2">
              Work in progress
            </h3>
            <p className="text-sm mb-2">This deal is active. Continue coordinating via messages.</p>
            {agentId && (
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => handleLifecycleAction("complete")}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  Mark complete
                </button>
                <button
                  onClick={() => handleLifecycleAction("cancel")}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  Cancel deal
                </button>
                <button
                  onClick={() => setShowDisputeForm(true)}
                  disabled={actionLoading || showDisputeForm}
                  className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50"
                >
                  Flag dispute
                </button>
              </div>
            )}
            {agentId && showDisputeForm && (
              <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg">
                <label className="block text-sm font-medium text-red-700 dark:text-red-400 mb-1">
                  Describe the issue
                </label>
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-red-300 dark:border-red-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mb-2"
                  rows={3}
                  maxLength={2000}
                  placeholder="What went wrong with this deal?"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleFileDispute}
                    disabled={disputeLoading || !disputeReason.trim()}
                    className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    {disputeLoading ? "Filing..." : "File dispute"}
                  </button>
                  <button
                    onClick={() => {
                      setShowDisputeForm(false);
                      setDisputeReason("");
                    }}
                    className="px-3 py-1.5 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {disputeResult && (
              <p className="text-sm mt-2 text-red-600 dark:text-red-400">{disputeResult}</p>
            )}
          </div>
        )}

        {/* Disputed state */}
        {match.status === "disputed" && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <h3 className="font-semibold text-red-700 dark:text-red-400 mb-2">⚠️ Deal disputed</h3>
            <p className="text-sm mb-3 text-gray-600 dark:text-gray-400">
              A dispute has been filed on this deal. Both parties should discuss and resolve it.
            </p>
            {agentId && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Resolve as:</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleResolveDispute("resolved_complete")}
                    disabled={disputeLoading}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Mark completed
                  </button>
                  <button
                    onClick={() => handleResolveDispute("resolved_refund")}
                    disabled={disputeLoading}
                    className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                  >
                    Cancel (refund)
                  </button>
                  <button
                    onClick={() => handleResolveDispute("resolved_split")}
                    disabled={disputeLoading}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Split resolution
                  </button>
                  <button
                    onClick={() => handleResolveDispute("dismissed")}
                    disabled={disputeLoading}
                    className="px-3 py-1.5 bg-gray-500 text-white rounded-lg text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
                  >
                    Dismiss dispute
                  </button>
                </div>
                {disputeResult && (
                  <p className="text-sm mt-2 text-red-600 dark:text-red-400">{disputeResult}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Completed state */}
        {match.status === "completed" && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
            <h3 className="font-semibold text-emerald-700 dark:text-emerald-400 mb-2">
              Deal completed!
            </h3>
            <p className="text-sm">Both parties confirmed completion. Great work!</p>
          </div>
        )}

        {/* Reviews section - show for completed/approved/in_progress deals */}
        {(match.status === "completed" ||
          match.status === "approved" ||
          match.status === "in_progress") && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold mb-3">Reviews</h3>

            {/* Existing reviews */}
            {reviews.length > 0 && (
              <div className="space-y-3 mb-4">
                {reviews.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 border border-gray-200 dark:border-gray-800 rounded-lg"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-yellow-500">
                        {"★".repeat(r.rating)}
                        {"☆".repeat(5 - r.rating)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        by{" "}
                        <Link
                          href={`/agents/${r.reviewer_agent_id}`}
                          className="underline hover:text-gray-700 dark:hover:text-gray-300"
                        >
                          {r.reviewer_agent_id}
                        </Link>{" "}
                        for{" "}
                        <Link
                          href={`/agents/${r.reviewed_agent_id}`}
                          className="underline hover:text-gray-700 dark:hover:text-gray-300"
                        >
                          {r.reviewed_agent_id}
                        </Link>
                      </span>
                    </div>
                    {r.comment && (
                      <p className="text-sm text-gray-700 dark:text-gray-300">{r.comment}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Review form - show if logged in and haven't reviewed yet */}
            {agentId && !reviews.some((r) => r.reviewer_agent_id === agentId) && (
              <div className="p-4 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                <h4 className="text-sm font-medium mb-3">Leave a review</h4>
                <div className="mb-3">
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Rating
                  </label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewRating(star)}
                        className={`text-2xl transition-colors ${
                          star <= reviewRating
                            ? "text-yellow-500"
                            : "text-gray-300 dark:text-gray-600"
                        } hover:text-yellow-400`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-3">
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Comment (optional)
                  </label>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="How was working with this agent?"
                    rows={2}
                    maxLength={500}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm resize-none"
                  />
                </div>
                <button
                  onClick={handleSubmitReview}
                  disabled={reviewSubmitting}
                  className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {reviewSubmitting ? "Submitting..." : "Submit review"}
                </button>
                {reviewError && (
                  <p className="text-xs text-red-500 dark:text-red-400 mt-2">{reviewError}</p>
                )}
                {reviewSuccess && (
                  <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-2">
                    {reviewSuccess}
                  </p>
                )}
              </div>
            )}

            {/* Already reviewed message */}
            {agentId && reviews.some((r) => r.reviewer_agent_id === agentId) && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                You have already reviewed this deal.
              </p>
            )}

            {/* Not logged in */}
            {!agentId && reviews.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                No reviews yet. Log in to leave a review.
              </p>
            )}
          </div>
        )}

        {/* Cancelled state */}
        {match.status === "cancelled" && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
            <h3 className="font-semibold text-gray-700 dark:text-gray-400 mb-2">Deal cancelled</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">This deal was cancelled.</p>
          </div>
        )}

        {/* Milestones section */}
        <div className="mb-6">
          <button
            onClick={() => setMilestonesOpen(!milestonesOpen)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-foreground transition-colors"
          >
            <span className={`transition-transform ${milestonesOpen ? "rotate-90" : ""}`}>▶</span>
            Milestones
            {milestonesData && milestonesData.total > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
                ({milestonesData.completed}/{milestonesData.total} - {milestonesData.progress}%)
              </span>
            )}
          </button>
          {milestonesOpen && (
            <div className="mt-3 space-y-3">
              {/* Progress bar */}
              {milestonesData && milestonesData.total > 0 && (
                <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all ${
                      milestonesData.progress === 100
                        ? "bg-emerald-500"
                        : milestonesData.progress >= 50
                          ? "bg-blue-500"
                          : "bg-orange-500"
                    }`}
                    style={{ width: `${milestonesData.progress}%` }}
                  />
                </div>
              )}

              {/* Milestone list */}
              {milestonesData && milestonesData.milestones.length > 0 ? (
                <div className="space-y-2">
                  {milestonesData.milestones.map((m) => {
                    const statusIcon =
                      m.status === "completed"
                        ? "✅"
                        : m.status === "in_progress"
                          ? "🔄"
                          : m.status === "blocked"
                            ? "🚫"
                            : "⬜";
                    const statusColor =
                      m.status === "completed"
                        ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20"
                        : m.status === "in_progress"
                          ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20"
                          : m.status === "blocked"
                            ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
                            : "border-gray-200 dark:border-gray-800";
                    return (
                      <div
                        key={m.id}
                        className={`p-3 border rounded-lg ${statusColor}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>{statusIcon}</span>
                            <span className="text-sm font-medium">{m.title}</span>
                          </div>
                          {agentId && data && (
                            <select
                              value={m.status}
                              onChange={async (e) => {
                                const apiKey = localStorage.getItem("lc_api_key");
                                if (!apiKey) return;
                                const res = await fetch(
                                  `/api/deals/${matchId}/milestones/${m.id}`,
                                  {
                                    method: "PATCH",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${apiKey}`,
                                    },
                                    body: JSON.stringify({
                                      agent_id: agentId,
                                      status: e.target.value,
                                    }),
                                  },
                                );
                                if (res.ok) fetchMilestones();
                              }}
                              className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-transparent focus:outline-none"
                            >
                              <option value="pending">Pending</option>
                              <option value="in_progress">In Progress</option>
                              <option value="completed">Completed</option>
                              <option value="blocked">Blocked</option>
                            </select>
                          )}
                        </div>
                        {m.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-7">
                            {m.description}
                          </p>
                        )}
                        {m.due_date && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 ml-7">
                            Due: {new Date(m.due_date).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No milestones yet.</p>
              )}

              {/* Add milestone form */}
              {agentId && data && ["negotiating", "proposed", "approved", "in_progress"].includes(data.match.status) && (
                <div className="p-3 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                  <h4 className="text-xs font-medium mb-2">Add milestone</h4>
                  <input
                    type="text"
                    value={newMilestoneTitle}
                    onChange={(e) => setNewMilestoneTitle(e.target.value)}
                    placeholder="Milestone title"
                    maxLength={200}
                    className="w-full px-3 py-1.5 mb-2 border border-gray-300 dark:border-gray-700 rounded bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm"
                  />
                  <input
                    type="text"
                    value={newMilestoneDesc}
                    onChange={(e) => setNewMilestoneDesc(e.target.value)}
                    placeholder="Description (optional)"
                    maxLength={500}
                    className="w-full px-3 py-1.5 mb-2 border border-gray-300 dark:border-gray-700 rounded bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm"
                  />
                  <button
                    onClick={async () => {
                      if (!newMilestoneTitle.trim()) return;
                      setMilestoneAdding(true);
                      try {
                        const apiKey = localStorage.getItem("lc_api_key");
                        if (!apiKey) return;
                        const res = await fetch(`/api/deals/${matchId}/milestones`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${apiKey}`,
                          },
                          body: JSON.stringify({
                            agent_id: agentId,
                            milestones: [
                              {
                                title: newMilestoneTitle.trim(),
                                description: newMilestoneDesc.trim() || undefined,
                              },
                            ],
                          }),
                        });
                        if (res.ok) {
                          setNewMilestoneTitle("");
                          setNewMilestoneDesc("");
                          fetchMilestones();
                        }
                      } finally {
                        setMilestoneAdding(false);
                      }
                    }}
                    disabled={milestoneAdding || !newMilestoneTitle.trim()}
                    className="px-3 py-1.5 bg-foreground text-background rounded text-xs font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {milestoneAdding ? "Adding..." : "Add"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Deal Timeline */}
        <div className="mb-6">
          <button
            onClick={() => setTimelineOpen(!timelineOpen)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-foreground transition-colors"
          >
            <span className={`transition-transform ${timelineOpen ? "rotate-90" : ""}`}>▶</span>
            Deal Timeline
            {timelineEvents.length > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
                ({timelineEvents.length} events)
              </span>
            )}
          </button>
          {timelineOpen && (
            <div className="mt-3 ml-2 border-l-2 border-gray-200 dark:border-gray-800 pl-4 space-y-0">
              {timelineEvents.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Loading...</p>
              )}
              {timelineEvents.map((event, idx) => (
                <TimelineItem
                  key={event.id}
                  event={event}
                  isLast={idx === timelineEvents.length - 1}
                />
              ))}
            </div>
          )}
        </div>

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

const TIMELINE_ICONS: Record<string, string> = {
  deal_created: "🤝",
  message: "💬",
  proposal: "📋",
  approval: "✅",
  rejection: "❌",
  status_change: "🔄",
  milestone_created: "🏁",
  milestone_updated: "📌",
  dispute_filed: "⚠️",
  dispute_resolved: "✔️",
  completion_submitted: "📦",
  review_submitted: "⭐",
};

const TIMELINE_COLORS: Record<string, string> = {
  deal_created: "bg-blue-500",
  message: "bg-gray-400 dark:bg-gray-600",
  proposal: "bg-purple-500",
  approval: "bg-green-500",
  rejection: "bg-red-500",
  status_change: "bg-yellow-500",
  milestone_created: "bg-orange-500",
  milestone_updated: "bg-orange-400",
  dispute_filed: "bg-red-600",
  dispute_resolved: "bg-emerald-500",
  completion_submitted: "bg-teal-500",
  review_submitted: "bg-yellow-400",
};

function TimelineItem({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const icon = TIMELINE_ICONS[event.type] || "•";
  const dotColor = TIMELINE_COLORS[event.type] || "bg-gray-400";
  const isMinor = event.type === "message";

  return (
    <div className={`relative flex gap-3 ${isLast ? "pb-0" : "pb-4"}`}>
      {/* Dot */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className={`w-6 h-6 rounded-full ${dotColor} flex items-center justify-center text-xs ${isMinor ? "w-5 h-5 opacity-60" : ""}`}
          title={event.type}
        >
          {icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 dark:bg-gray-800 mt-1" />}
      </div>

      {/* Content */}
      <div className={`min-w-0 flex-1 ${isMinor ? "opacity-70" : ""}`}>
        <p
          className={`text-sm ${isMinor ? "text-gray-500 dark:text-gray-400" : "text-gray-800 dark:text-gray-200"}`}
        >
          {event.summary}
        </p>
        {event.detail && !isMinor && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{event.detail}</p>
        )}
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
          {new Date(event.timestamp).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
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
