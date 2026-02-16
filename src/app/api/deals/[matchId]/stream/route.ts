import { NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import type { Match, MatchStatus, Message, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * SSE endpoint for real-time deal updates.
 * Streams new messages and status changes as they happen.
 *
 * Query params:
 *   - after_id: only send messages with id > this value
 *
 * Events:
 *   - message: new message in the deal
 *   - status: deal status changed
 *   - ping: keepalive (every 15s)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "deal-stream");
  if (rl) return rl;
  const auth = await authenticateAny(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { matchId } = await params;
  const afterId = parseInt(req.nextUrl.searchParams.get("after_id") || "0", 10);

  const db = await ensureDb();

  // Verify deal exists and user is a participant
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;
  if (!match) {
    return new Response(JSON.stringify({ error: "Deal not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const profileAResult = await db.execute({
    sql: "SELECT agent_id FROM profiles WHERE id = ?",
    args: [match.profile_a_id],
  });
  const profileA = profileAResult.rows[0] as unknown as Pick<Profile, "agent_id"> | undefined;

  const profileBResult = await db.execute({
    sql: "SELECT agent_id FROM profiles WHERE id = ?",
    args: [match.profile_b_id],
  });
  const profileB = profileBResult.rows[0] as unknown as Pick<Profile, "agent_id"> | undefined;

  const isParticipant =
    profileA?.agent_id === auth.agent_id || profileB?.agent_id === auth.agent_id;

  let isOwner = false;
  if (!isParticipant && auth.user_id) {
    const ownerCheck = await db.execute({
      sql: "SELECT 1 FROM api_keys WHERE user_id = ? AND agent_id IN (?, ?)",
      args: [auth.user_id, profileA?.agent_id ?? "", profileB?.agent_id ?? ""],
    });
    isOwner = ownerCheck.rows.length > 0;
  }

  if (!isParticipant && !isOwner) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Set up SSE stream
  const encoder = new TextEncoder();
  let closed = false;
  let lastMessageId = afterId;
  let lastStatus: MatchStatus = match.status;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      // Poll for changes every 2 seconds
      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        try {
          const db = await ensureDb();

          // Check for new messages
          const newMessages = await db.execute({
            sql: "SELECT * FROM messages WHERE match_id = ? AND id > ? ORDER BY id ASC",
            args: [matchId, lastMessageId],
          });

          for (const row of newMessages.rows) {
            const msg = row as unknown as Message;
            send("message", {
              id: msg.id,
              sender_agent_id: msg.sender_agent_id,
              content: msg.content,
              message_type: msg.message_type,
              proposed_terms: msg.proposed_terms ? JSON.parse(msg.proposed_terms) : null,
              created_at: msg.created_at,
            });
            lastMessageId = msg.id as number;
          }

          // Check for status changes
          const statusResult = await db.execute({
            sql: "SELECT status FROM matches WHERE id = ?",
            args: [matchId],
          });
          const currentStatus = (statusResult.rows[0] as unknown as { status: MatchStatus })?.status;
          if (currentStatus && currentStatus !== lastStatus) {
            send("status", { status: currentStatus });
            lastStatus = currentStatus;

            // Close stream on terminal states
            if (
              currentStatus === "rejected" ||
              currentStatus === "expired" ||
              currentStatus === "cancelled"
            ) {
              closed = true;
              clearInterval(interval);
              controller.close();
              return;
            }
          }
        } catch {
          // DB error - skip this tick
        }
      }, 2000);

      // Keepalive ping every 15s
      const pingInterval = setInterval(() => {
        if (closed) {
          clearInterval(pingInterval);
          return;
        }
        send("ping", { ts: Date.now() });
      }, 15_000);

      // Auto-close after 5 minutes (client should reconnect)
      const timeout = setTimeout(
        () => {
          closed = true;
          clearInterval(interval);
          clearInterval(pingInterval);
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
        5 * 60 * 1000,
      );

      // Handle abort
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        clearInterval(pingInterval);
        clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
