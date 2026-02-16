import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { renewListing } from "@/lib/listing-expiry";

/**
 * POST /api/profiles/:profileId/renew - Renew (extend) a listing
 * Body: { agent_id: string }
 * Returns: { renewed, expires_at, reactivated }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentId = (body.agent_id as string) || auth.agent_id;
  if (agentId !== auth.agent_id) {
    return NextResponse.json(
      { error: "agent_id does not match authenticated key" },
      { status: 403 },
    );
  }

  const { profileId } = await params;
  const db = await ensureDb();
  const result = await renewListing(db, profileId, agentId);

  if (!result.renewed) {
    const status = result.error === "Profile not found" ? 404 : 403;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    renewed: true,
    profile_id: profileId,
    expires_at: result.expires_at,
    reactivated: result.reactivated,
  });
}
