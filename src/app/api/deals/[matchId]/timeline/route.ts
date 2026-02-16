import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export interface TimelineEvent {
  id: string;
  type:
    | "deal_created"
    | "message"
    | "proposal"
    | "approval"
    | "rejection"
    | "status_change"
    | "milestone_created"
    | "milestone_updated"
    | "dispute_filed"
    | "dispute_resolved"
    | "completion_submitted"
    | "review_submitted";
  actor: string | null;
  summary: string;
  detail: string | null;
  timestamp: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const rl = checkRateLimit(request, 30, 60_000, "timeline");
  if (rl) return rl;

  const { matchId } = await params;
  const db = await ensureDb();

  // Verify the deal exists
  const match = await db.execute({
    sql: "SELECT id, status, created_at FROM matches WHERE id = ?",
    args: [matchId],
  });

  if (match.rows.length === 0) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const events: TimelineEvent[] = [];
  const deal = match.rows[0];

  // 1. Deal created
  events.push({
    id: `deal-created-${matchId}`,
    type: "deal_created",
    actor: null,
    summary: "Deal created",
    detail: "Match found between both parties",
    timestamp: deal.created_at as string,
  });

  // 2. Messages (negotiation + proposal + system)
  const messages = await db.execute({
    sql: `SELECT id, sender_agent_id, content, message_type, proposed_terms, created_at
          FROM messages WHERE match_id = ? ORDER BY created_at ASC`,
    args: [matchId],
  });

  for (const msg of messages.rows) {
    const msgType = msg.message_type as string;
    if (msgType === "proposal") {
      events.push({
        id: `proposal-${msg.id}`,
        type: "proposal",
        actor: msg.sender_agent_id as string,
        summary: `${msg.sender_agent_id} submitted a proposal`,
        detail: (msg.content as string).slice(0, 200),
        timestamp: msg.created_at as string,
      });
    } else if (msgType === "system") {
      events.push({
        id: `system-${msg.id}`,
        type: "status_change",
        actor: null,
        summary: msg.content as string,
        detail: null,
        timestamp: msg.created_at as string,
      });
    } else {
      events.push({
        id: `msg-${msg.id}`,
        type: "message",
        actor: msg.sender_agent_id as string,
        summary: `${msg.sender_agent_id} sent a message`,
        detail: (msg.content as string).slice(0, 120),
        timestamp: msg.created_at as string,
      });
    }
  }

  // 3. Approvals
  const approvals = await db.execute({
    sql: `SELECT id, agent_id, approved, created_at
          FROM approvals WHERE match_id = ? ORDER BY created_at ASC`,
    args: [matchId],
  });

  for (const a of approvals.rows) {
    const approved = a.approved as number;
    events.push({
      id: `approval-${a.id}`,
      type: approved ? "approval" : "rejection",
      actor: a.agent_id as string,
      summary: approved ? `${a.agent_id} approved the deal` : `${a.agent_id} rejected the deal`,
      detail: null,
      timestamp: a.created_at as string,
    });
  }

  // 4. Deal completions (evidence submissions)
  const completions = await db.execute({
    sql: `SELECT id, agent_id, evidence, created_at
          FROM deal_completions WHERE match_id = ? ORDER BY created_at ASC`,
    args: [matchId],
  });

  for (const c of completions.rows) {
    events.push({
      id: `completion-${c.id}`,
      type: "completion_submitted",
      actor: c.agent_id as string,
      summary: `${c.agent_id} submitted completion evidence`,
      detail: c.evidence ? (c.evidence as string).slice(0, 120) : null,
      timestamp: c.created_at as string,
    });
  }

  // 5. Milestones
  const milestones = await db.execute({
    sql: `SELECT id, title, status, created_by, created_at, updated_at
          FROM deal_milestones WHERE match_id = ? ORDER BY created_at ASC`,
    args: [matchId],
  });

  for (const m of milestones.rows) {
    events.push({
      id: `milestone-created-${m.id}`,
      type: "milestone_created",
      actor: m.created_by as string,
      summary: `Milestone created: ${m.title}`,
      detail: `Status: ${m.status}`,
      timestamp: m.created_at as string,
    });
    // If updated after creation, add an update event
    if (m.updated_at !== m.created_at) {
      events.push({
        id: `milestone-updated-${m.id}`,
        type: "milestone_updated",
        actor: m.created_by as string,
        summary: `Milestone updated: ${m.title}`,
        detail: `Status: ${m.status}`,
        timestamp: m.updated_at as string,
      });
    }
  }

  // 6. Disputes
  const disputes = await db.execute({
    sql: `SELECT id, filed_by_agent_id, reason, status, resolution_note, resolved_by, created_at, resolved_at
          FROM disputes WHERE match_id = ? ORDER BY created_at ASC`,
    args: [matchId],
  });

  for (const d of disputes.rows) {
    events.push({
      id: `dispute-filed-${d.id}`,
      type: "dispute_filed",
      actor: d.filed_by_agent_id as string,
      summary: `${d.filed_by_agent_id} filed a dispute`,
      detail: (d.reason as string).slice(0, 120),
      timestamp: d.created_at as string,
    });
    if (d.resolved_at) {
      events.push({
        id: `dispute-resolved-${d.id}`,
        type: "dispute_resolved",
        actor: d.resolved_by as string | null,
        summary: `Dispute resolved: ${d.status}`,
        detail: d.resolution_note ? (d.resolution_note as string).slice(0, 120) : null,
        timestamp: d.resolved_at as string,
      });
    }
  }

  // 7. Reviews
  const reviews = await db.execute({
    sql: `SELECT id, reviewer_agent_id, reviewed_agent_id, rating, comment, created_at
          FROM reviews WHERE match_id = ? ORDER BY created_at ASC`,
    args: [matchId],
  });

  for (const r of reviews.rows) {
    events.push({
      id: `review-${r.id}`,
      type: "review_submitted",
      actor: r.reviewer_agent_id as string,
      summary: `${r.reviewer_agent_id} reviewed ${r.reviewed_agent_id} (${"★".repeat(r.rating as number)}${"☆".repeat(5 - (r.rating as number))})`,
      detail: r.comment ? (r.comment as string).slice(0, 120) : null,
      timestamp: r.created_at as string,
    });
  }

  // Sort all events by timestamp
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return NextResponse.json({
    match_id: matchId,
    status: deal.status as string,
    event_count: events.length,
    events,
  });
}
