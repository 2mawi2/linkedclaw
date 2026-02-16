import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { POST as reviewPOST } from "@/app/api/reputation/[agentId]/review/route";
import { GET as dealReviewsGET } from "@/app/api/deals/[matchId]/reviews/route";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;
let aliceKey: string;
let bobKey: string;

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  aliceKey = await createApiKey("alice");
  bobKey = await createApiKey("bob");
});

afterEach(() => {
  restore();
});

function jsonReq(url: string, body?: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest(`http://localhost:3000${url}`, {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers,
  });
}

async function createApprovedDeal(): Promise<string> {
  const r1 = await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: "alice",
        side: "offering",
        category: "dev",
        params: { skills: ["react", "ts"], rate_min: 50, rate_max: 70 },
      },
      aliceKey,
    ),
  );
  const { profile_id: offeringId } = await r1.json();

  await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: "bob",
        side: "seeking",
        category: "dev",
        params: { skills: ["react"], rate_min: 40, rate_max: 60 },
      },
      bobKey,
    ),
  );

  const matchRes = await matchesGET(jsonReq(`/api/matches/${offeringId}`), {
    params: Promise.resolve({ profileId: offeringId }),
  });
  const { matches } = await matchRes.json();
  const matchId = matches[0].match_id;

  await messagesPOST(
    jsonReq(
      `/api/deals/${matchId}/messages`,
      {
        agent_id: "alice",
        content: "Terms",
        message_type: "proposal",
        proposed_terms: { rate: 55 },
      },
      aliceKey,
    ),
    { params: Promise.resolve({ matchId }) },
  );

  await approvePOST(
    jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "alice", approved: true }, aliceKey),
    { params: Promise.resolve({ matchId }) },
  );
  await approvePOST(
    jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "bob", approved: true }, bobKey),
    { params: Promise.resolve({ matchId }) },
  );

  return matchId;
}

describe("GET /api/deals/:matchId/reviews", () => {
  it("returns empty reviews for deal with no reviews", async () => {
    const matchId = await createApprovedDeal();
    const res = await dealReviewsGET(jsonReq(`/api/deals/${matchId}/reviews`), {
      params: Promise.resolve({ matchId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.match_id).toBe(matchId);
    expect(data.reviews).toEqual([]);
  });

  it("returns reviews after submission", async () => {
    const matchId = await createApprovedDeal();

    // Alice reviews Bob
    await reviewPOST(
      jsonReq(
        "/api/reputation/bob/review",
        { match_id: matchId, rating: 5, comment: "Excellent!" },
        aliceKey,
      ),
      { params: Promise.resolve({ agentId: "bob" }) },
    );

    // Bob reviews Alice
    await reviewPOST(
      jsonReq(
        "/api/reputation/alice/review",
        { match_id: matchId, rating: 4, comment: "Good work" },
        bobKey,
      ),
      { params: Promise.resolve({ agentId: "alice" }) },
    );

    const res = await dealReviewsGET(jsonReq(`/api/deals/${matchId}/reviews`), {
      params: Promise.resolve({ matchId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reviews).toHaveLength(2);

    const aliceReview = data.reviews.find(
      (r: { reviewer_agent_id: string }) => r.reviewer_agent_id === "alice",
    );
    expect(aliceReview.rating).toBe(5);
    expect(aliceReview.comment).toBe("Excellent!");
    expect(aliceReview.reviewed_agent_id).toBe("bob");

    const bobReview = data.reviews.find(
      (r: { reviewer_agent_id: string }) => r.reviewer_agent_id === "bob",
    );
    expect(bobReview.rating).toBe(4);
    expect(bobReview.comment).toBe("Good work");
    expect(bobReview.reviewed_agent_id).toBe("alice");
  });

  it("returns 404 for nonexistent deal", async () => {
    const res = await dealReviewsGET(jsonReq("/api/deals/nonexistent/reviews"), {
      params: Promise.resolve({ matchId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  it("is a public endpoint (no auth required)", async () => {
    const matchId = await createApprovedDeal();
    // No auth header
    const res = await dealReviewsGET(jsonReq(`/api/deals/${matchId}/reviews`), {
      params: Promise.resolve({ matchId }),
    });
    expect(res.status).toBe(200);
  });
});
