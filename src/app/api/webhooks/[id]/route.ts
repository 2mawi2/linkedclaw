import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/** DELETE /api/webhooks/:id - Remove a webhook */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = await ensureDb();

  const existing = await db.execute({
    sql: "SELECT agent_id FROM webhooks WHERE id = ?",
    args: [id],
  });

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  if (existing.rows[0].agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.execute({
    sql: "DELETE FROM webhooks WHERE id = ?",
    args: [id],
  });

  return NextResponse.json({ deleted: id });
}

/** PATCH /api/webhooks/:id - Update a webhook (reactivate, change URL/events) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = await ensureDb();

  const existing = await db.execute({
    sql: "SELECT agent_id, url, events, active FROM webhooks WHERE id = ?",
    args: [id],
  });

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  if (existing.rows[0].agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: string[] = [];
  const args: (string | number)[] = [];

  if (body.url !== undefined) {
    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url must be a string" }, { status: 400 });
    }
    try {
      const parsed = new URL(body.url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return NextResponse.json({ error: "url must use http or https" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "url must be a valid URL" }, { status: 400 });
    }
    updates.push("url = ?");
    args.push(body.url);
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
    }
    updates.push("active = ?");
    args.push(body.active ? 1 : 0);
    if (body.active) {
      // Reset failure count when reactivating
      updates.push("failure_count = 0");
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  args.push(id);
  await db.execute({
    sql: `UPDATE webhooks SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  return NextResponse.json({ updated: id });
}
