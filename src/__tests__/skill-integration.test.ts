/**
 * Skill Integration Test (Issue #8)
 *
 * Exercises the FULL agent workflow described in skill/negotiate.md,
 * validating that every response format matches what the skill doc promises.
 *
 * This simulates two agents (alice and bob) going through:
 *   Phase 0: Authentication
 *   Discovery: Search, categories, tags, market rates, agent summary
 *   Phase 1-2: Register profiles
 *   Phase 3: Find matches, check inbox
 *   Phase 4: Negotiate with messages, propose terms
 *   Phase 5: Approve deal
 *   Phase 5b: Start, milestones, complete
 *   Post-deal: Reviews, portfolio, reputation
 *   Extras: Webhooks, activity feed, templates, cancel flow
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { NextRequest } from "next/server";

// Route imports - all endpoints referenced in the skill doc
import { POST as keysPOST } from "@/app/api/keys/route";
import { createApiKey } from "@/__tests__/test-helpers";
import { POST as connectPOST, DELETE as connectDELETE } from "@/app/api/connect/route";
import { GET as connectAgentGET } from "@/app/api/connect/[agentId]/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { GET as batchMatchesGET } from "@/app/api/matches/batch/route";
import { GET as searchGET } from "@/app/api/search/route";
import { GET as categoriesGET } from "@/app/api/categories/route";
import { GET as tagsGET } from "@/app/api/tags/route";
import { GET as statsGET } from "@/app/api/stats/route";
import { GET as templateGET, POST as templatePOST } from "@/app/api/templates/route";
import { GET as marketGET } from "@/app/api/market/[category]/route";
import { GET as agentSummaryGET } from "@/app/api/agents/[agentId]/summary/route";
import { GET as portfolioGET } from "@/app/api/agents/[agentId]/portfolio/route";
import { GET as dealsGET } from "@/app/api/deals/route";
import { GET as dealDetailGET } from "@/app/api/deals/[matchId]/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { POST as startPOST } from "@/app/api/deals/[matchId]/start/route";
import { POST as completePOST } from "@/app/api/deals/[matchId]/complete/route";
import { POST as cancelPOST } from "@/app/api/deals/[matchId]/cancel/route";
import { POST as milestonesPOST, GET as milestonesGET } from "@/app/api/deals/[matchId]/milestones/route";
import { PATCH as milestonePATCH } from "@/app/api/deals/[matchId]/milestones/[milestoneId]/route";
import { GET as inboxGET } from "@/app/api/inbox/route";
import { POST as inboxReadPOST } from "@/app/api/inbox/read/route";
import { GET as activityGET } from "@/app/api/activity/route";
import { GET as reputationGET } from "@/app/api/reputation/[agentId]/route";
import { POST as reputationPOST } from "@/app/api/reputation/[agentId]/review/route";
import { POST as webhooksPOST, GET as webhooksGET } from "@/app/api/webhooks/route";
import { DELETE as webhookDELETE, PATCH as webhookPATCH } from "@/app/api/webhooks/[id]/route";
import { GET as profileGET, PATCH as profilePATCH } from "@/app/api/profiles/[profileId]/route";
import { GET as openapiGET } from "@/app/api/openapi.json/route";

let db: Client;
let restore: () => void;

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
});

afterEach(() => {
  restore();
});

// Helper to make requests matching how the skill doc shows them
function req(url: string, opts?: { method?: string; body?: unknown; apiKey?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts?.body) headers["Content-Type"] = "application/json";
  if (opts?.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
  return new NextRequest(`http://localhost:3000${url}`, {
    method: opts?.method ?? (opts?.body ? "POST" : "GET"),
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
    headers,
  });
}

function params(r: NextRequest): Record<string, string> {
  const url = new URL(r.url);
  const result: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (result[k] = v));
  return result;
}

async function getApiKey(agentId: string): Promise<string> { return createApiKey(agentId); }

describe("Skill Doc Integration: Full Agent Lifecycle", () => {
  let aliceKey: string;
  let bobKey: string;

  beforeEach(async () => {
    aliceKey = await getApiKey("alice-agent");
    bobKey = await getApiKey("bob-agent");
  });

  it("Phase 0: API key generation requires auth and matches skill doc format", async () => {
    // Unauthenticated request is rejected
    const unauth = await keysPOST(req("/api/keys", { body: { agent_id: "test-agent" } }));
    expect(unauth.status).toBe(401);

    // Authenticated request succeeds
    const existingKey = await getApiKey("test-agent");
    const res = await keysPOST(req("/api/keys", { apiKey: existingKey }));
    expect(res.status).toBe(201);
    const data = await res.json();

    // Skill doc promises: { api_key, key_id, agent_id }
    expect(data).toHaveProperty("api_key");
    expect(data).toHaveProperty("key_id");
    expect(data).toHaveProperty("agent_id", "test-agent");
    expect(data.api_key).toMatch(/^lc_/); // lc_ prefix
  });

  it("Phase 2: Profile registration matches skill doc format", async () => {
    // Register as shown in skill doc
    const res = await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: {
        agent_id: "alice-agent",
        side: "offering",
        category: "freelance-dev",
        params: {
          skills: ["React", "TypeScript", "Node.js"],
          rate_min: 80,
          rate_max: 120,
          currency: "EUR",
          availability: "from March 2026",
          hours_min: 20,
          hours_max: 40,
          duration_min_weeks: 4,
          duration_max_weeks: 26,
          remote: "remote",
        },
        description: "Senior React dev with 8 years experience",
      },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Skill doc promises: { profile_id }
    expect(data).toHaveProperty("profile_id");
    expect(typeof data.profile_id).toBe("string");
  });

  it("Phase 2: Re-registration returns replaced_profile_id", async () => {
    // First registration
    const res1 = await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: { agent_id: "alice-agent", side: "offering", category: "freelance-dev", params: { skills: ["React"] }, description: "v1" },
    }));
    const data1 = await res1.json();

    // Re-register same agent/side/category
    const res2 = await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: { agent_id: "alice-agent", side: "offering", category: "freelance-dev", params: { skills: ["React", "Vue"] }, description: "v2" },
    }));
    const data2 = await res2.json();

    // Skill doc promises: { profile_id, replaced_profile_id }
    expect(data2).toHaveProperty("profile_id");
    expect(data2).toHaveProperty("replaced_profile_id", data1.profile_id);
  });

  it("Discovery: search response includes reputation field", async () => {
    // Register a profile first
    await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: { agent_id: "alice-agent", side: "offering", category: "ai-dev", params: { skills: ["TypeScript"] }, description: "AI dev" },
    }));

    const r = req("/api/search?category=ai-dev");
    const res = await searchGET(r);
    const data = await res.json();

    // API returns { profiles, total, limit, offset }
    expect(data).toHaveProperty("profiles");
    expect(data.profiles.length).toBeGreaterThan(0);
    // Skill doc says: each profile includes reputation
    expect(data.profiles[0]).toHaveProperty("reputation");
  });

  it("Discovery: categories, tags, stats, templates, market rates", async () => {
    // Register profiles to populate data
    await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: { agent_id: "alice-agent", side: "offering", category: "freelance-dev", params: { skills: ["React"], rate_min: 80, rate_max: 120 }, description: "Dev" },
    }));

    // Categories
    const catRes = await categoriesGET();
    expect(catRes.status).toBe(200);
    const catData = await catRes.json();
    expect(catData).toHaveProperty("categories");

    // Tags
    const tagRes = await tagsGET(req("/api/tags"));
    expect(tagRes.status).toBe(200);

    // Stats
    const statsRes = await statsGET();
    expect(statsRes.status).toBe(200);

    // Templates - skill doc says returns built-in + custom templates
    const tmplRes = await templateGET(req("/api/templates"));
    expect(tmplRes.status).toBe(200);
    const tmplData = await tmplRes.json();
    expect(tmplData).toHaveProperty("templates");
    expect(tmplData.templates.length).toBeGreaterThan(0);

    // Market rates - skill doc says: rate_median, rate_p10, rate_p90, currency, etc.
    const mktReq = req("/api/market/freelance-dev");
    const mktRes = await marketGET(mktReq, { params: Promise.resolve({ category: "freelance-dev" }) });
    expect(mktRes.status).toBe(200);
    const mktData = await mktRes.json();
    expect(mktData).toHaveProperty("category", "freelance-dev");
    expect(mktData).toHaveProperty("active_profiles");
  });

  it("Discovery: agent summary matches skill doc format", async () => {
    await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: { agent_id: "alice-agent", side: "offering", category: "dev", params: { skills: ["Go"] }, description: "Go dev" },
    }));

    const r = req("/api/agents/alice-agent/summary");
    const res = await agentSummaryGET(r, { params: Promise.resolve({ agentId: "alice-agent" }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    // Skill doc: profile count, active profiles, match stats, recent activity, member_since, category breakdown
    expect(data).toHaveProperty("agent_id", "alice-agent");
    expect(data).toHaveProperty("profile_count");
    expect(data).toHaveProperty("active_profiles");
  });

  it("Discovery: OpenAPI spec endpoint", async () => {
    const res = await openapiGET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("openapi", "3.0.3");
    expect(data).toHaveProperty("paths");
  });

  it("Full lifecycle: register -> match -> negotiate -> propose -> approve -> start -> milestones -> complete -> review", async () => {
    // === Phase 2: Register both agents ===
    const aliceRes = await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: {
        agent_id: "alice-agent",
        side: "offering",
        category: "freelance-dev",
        params: { skills: ["React", "TypeScript"], rate_min: 80, rate_max: 120, remote: "remote" },
        description: "Senior React dev",
      },
    }));
    const aliceProfile = (await aliceRes.json()).profile_id;

    const bobRes = await connectPOST(req("/api/connect", {
      apiKey: bobKey,
      body: {
        agent_id: "bob-agent",
        side: "seeking",
        category: "freelance-dev",
        params: { skills: ["React", "TypeScript", "GraphQL"], rate_min: 80, rate_max: 110, remote: "remote" },
        description: "E-commerce platform rebuild in Next.js",
      },
    }));
    const bobProfile = (await bobRes.json()).profile_id;

    // === Phase 3: Find matches ===
    // Skill doc format: { matches: [{ match_id, overlap: { matching_skills, rate_overlap, remote_compatible, score }, counterpart_agent_id, counterpart_description, ... }] }
    const matchRes = await matchesGET(
      req(`/api/matches/${aliceProfile}`),
      { params: Promise.resolve({ profileId: aliceProfile }) }
    );
    expect(matchRes.status).toBe(200);
    const matchData = await matchRes.json();
    expect(matchData).toHaveProperty("matches");
    expect(matchData.matches.length).toBe(1);

    const match = matchData.matches[0];
    expect(match).toHaveProperty("match_id");
    expect(match).toHaveProperty("overlap");
    expect(match.overlap).toHaveProperty("matching_skills");
    expect(match.overlap).toHaveProperty("rate_overlap");
    expect(match.overlap).toHaveProperty("remote_compatible", true);
    expect(match.overlap).toHaveProperty("score");
    expect(match).toHaveProperty("counterpart_agent_id", "bob-agent");
    expect(match).toHaveProperty("counterpart_description");
    expect(match.overlap.matching_skills).toContain("react");
    expect(match.overlap.matching_skills).toContain("typescript");
    expect(typeof match.overlap.score).toBe("number");
    expect(match.score).toBe(match.overlap.score); // top-level score field

    const matchId = match.match_id;

    // === Batch match check (skill doc: { agent_id, profiles: [{ profile_id, matches }], total_matches }) ===
    const batchRes = await batchMatchesGET(
      req(`/api/matches/batch?agent_id=alice-agent`, { apiKey: aliceKey })
    );
    expect(batchRes.status).toBe(200);
    const batchData = await batchRes.json();
    expect(batchData).toHaveProperty("agent_id", "alice-agent");
    expect(batchData).toHaveProperty("profiles");
    expect(batchData).toHaveProperty("total_matches");
    expect(batchData.profiles.length).toBeGreaterThan(0);
    expect(batchData.profiles[0]).toHaveProperty("profile_id");
    expect(batchData.profiles[0]).toHaveProperty("matches");
    expect(batchData.profiles[0].matches[0]).toHaveProperty("counterpart_reputation");

    // === Check inbox for match notification ===
    const inboxRes = await inboxGET(
      req(`/api/inbox?agent_id=alice-agent&unread_only=true`, { apiKey: aliceKey })
    );
    expect(inboxRes.status).toBe(200);
    const inboxData = await inboxRes.json();
    expect(inboxData).toHaveProperty("notifications");
    expect(inboxData).toHaveProperty("unread_count");

    // === Phase 4: Get deal context ===
    // Skill doc format: { match: { id, status, overlap, profiles: { a, b } }, messages, approvals }
    const dealRes = await dealDetailGET(
      req(`/api/deals/${matchId}`),
      { params: Promise.resolve({ matchId }) }
    );
    expect(dealRes.status).toBe(200);
    const dealData = await dealRes.json();
    expect(dealData).toHaveProperty("match");
    expect(dealData.match).toHaveProperty("id", matchId);
    expect(dealData.match).toHaveProperty("status", "matched");
    expect(dealData.match).toHaveProperty("overlap");
    expect(dealData.match).toHaveProperty("profiles");
    expect(dealData.match.profiles).toHaveProperty("a");
    expect(dealData.match.profiles).toHaveProperty("b");
    expect(dealData).toHaveProperty("messages");
    expect(dealData).toHaveProperty("approvals");

    // Verify profile data structure in deal
    const profileA = dealData.match.profiles.a;
    expect(profileA).toHaveProperty("id");
    expect(profileA).toHaveProperty("agent_id");
    expect(profileA).toHaveProperty("side");
    expect(profileA).toHaveProperty("category");
    expect(profileA).toHaveProperty("description");
    expect(profileA).toHaveProperty("params");

    // === Phase 4: Send negotiation messages ===
    // Skill doc: { agent_id, content, message_type: "negotiation" }
    const msg1Res = await messagesPOST(
      req(`/api/deals/${matchId}/messages`, {
        apiKey: aliceKey,
        body: {
          agent_id: "alice-agent",
          content: "Hi! I see we have a strong overlap on React and TypeScript. My rate is EUR 100-120/hr. What does the timeline look like?",
          message_type: "negotiation",
        },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(msg1Res.status).toBe(200);
    const msg1Data = await msg1Res.json();
    // Skill doc promises: { message_id, status }
    expect(msg1Data).toHaveProperty("message_id");
    expect(msg1Data).toHaveProperty("status", "negotiating");

    // Bob sends a message using "text" type (alias, per skill doc)
    const msg2Res = await messagesPOST(
      req(`/api/deals/${matchId}/messages`, {
        apiKey: bobKey,
        body: {
          agent_id: "bob-agent",
          content: "12-week engagement, starting mid-March. Budget EUR 85-100/hr. Can you do 30+ hours/week?",
          message_type: "text", // alias for negotiation
        },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(msg2Res.status).toBe(200);

    // Read messages - verify skill doc format
    const dealAfterMsgs = await dealDetailGET(
      req(`/api/deals/${matchId}`),
      { params: Promise.resolve({ matchId }) }
    );
    const msgsData = await dealAfterMsgs.json();
    expect(msgsData.messages.length).toBe(2);

    // Skill doc message format: { id, sender_agent_id, content, message_type, proposed_terms, created_at }
    const msg = msgsData.messages[0];
    expect(msg).toHaveProperty("id");
    expect(msg).toHaveProperty("sender_agent_id");
    expect(msg).toHaveProperty("content");
    expect(msg).toHaveProperty("message_type");
    expect(msg).toHaveProperty("created_at");

    // === Phase 4: Formal proposal ===
    const proposalRes = await messagesPOST(
      req(`/api/deals/${matchId}/messages`, {
        apiKey: aliceKey,
        body: {
          agent_id: "alice-agent",
          content: "Great, here are the terms we've agreed on:",
          message_type: "proposal",
          proposed_terms: {
            rate: 95,
            currency: "EUR",
            hours_per_week: 32,
            duration_weeks: 12,
            start_date: "2026-03-15",
            remote: "remote",
          },
        },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(proposalRes.status).toBe(200);
    const proposalData = await proposalRes.json();
    expect(proposalData.status).toBe("proposed");

    // === List all deals (skill doc: GET /api/deals?agent_id=xxx) ===
    const dealsListRes = await dealsGET(
      req(`/api/deals?agent_id=alice-agent`, { apiKey: aliceKey })
    );
    expect(dealsListRes.status).toBe(200);
    const dealsList = await dealsListRes.json();
    // Skill doc: { deals: [{ match_id, status, overlap, counterpart_agent_id, counterpart_description, created_at }] }
    expect(dealsList).toHaveProperty("deals");
    expect(dealsList.deals.length).toBe(1);
    expect(dealsList.deals[0]).toHaveProperty("match_id");
    expect(dealsList.deals[0]).toHaveProperty("status", "proposed");
    expect(dealsList.deals[0]).toHaveProperty("counterpart_agent_id");
    expect(dealsList.deals[0]).toHaveProperty("counterpart_description");

    // === Phase 5: Approve deal ===
    // Alice approves - skill doc: { status: "waiting", message: "..." }
    const aliceApproveRes = await approvePOST(
      req(`/api/deals/${matchId}/approve`, {
        apiKey: aliceKey,
        body: { agent_id: "alice-agent", approved: true },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(aliceApproveRes.status).toBe(200);
    const aliceApproveData = await aliceApproveRes.json();
    expect(aliceApproveData.status).toBe("waiting");
    expect(aliceApproveData).toHaveProperty("message");

    // Bob approves - skill doc: { status: "approved", message: "...", contact_exchange: { agent_a, agent_b } }
    const bobApproveRes = await approvePOST(
      req(`/api/deals/${matchId}/approve`, {
        apiKey: bobKey,
        body: { agent_id: "bob-agent", approved: true },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(bobApproveRes.status).toBe(200);
    const bobApproveData = await bobApproveRes.json();
    expect(bobApproveData.status).toBe("approved");
    expect(bobApproveData).toHaveProperty("message");
    expect(bobApproveData).toHaveProperty("contact_exchange");
    expect(bobApproveData.contact_exchange).toHaveProperty("agent_a");
    expect(bobApproveData.contact_exchange).toHaveProperty("agent_b");

    // === Phase 5b: Start deal ===
    const startRes = await startPOST(
      req(`/api/deals/${matchId}/start`, {
        apiKey: aliceKey,
        body: { agent_id: "alice-agent" },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(startRes.status).toBe(200);
    const startData = await startRes.json();
    expect(startData.status).toBe("in_progress");

    // === Post-approval messaging (skill doc: "You can continue sending messages after a deal is approved") ===
    const postApprovalMsg = await messagesPOST(
      req(`/api/deals/${matchId}/messages`, {
        apiKey: aliceKey,
        body: { agent_id: "alice-agent", content: "Let's set up a kickoff meeting", message_type: "text" },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(postApprovalMsg.status).toBe(200);

    // === Phase 5b: Add milestones ===
    const milestoneRes = await milestonesPOST(
      req(`/api/deals/${matchId}/milestones`, {
        apiKey: aliceKey,
        body: {
          agent_id: "alice-agent",
          milestones: [
            { title: "Phase 1: Setup", description: "Project scaffolding", due_date: "2026-03-01" },
            { title: "Phase 2: Core features", description: "Main implementation" },
            { title: "Phase 3: Testing & deploy" },
          ],
        },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect([200, 201]).toContain(milestoneRes.status);
    const milestoneData = await milestoneRes.json();
    expect(milestoneData).toHaveProperty("milestones");
    expect(milestoneData.milestones.length).toBe(3);

    // List milestones with progress
    const msListRes = await milestonesGET(
      req(`/api/deals/${matchId}/milestones`, { apiKey: aliceKey }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(msListRes.status).toBe(200);
    const msList = await msListRes.json();
    expect(msList).toHaveProperty("milestones");
    expect(msList).toHaveProperty("progress");

    // Update milestone status
    const msId = milestoneData.milestones[0].id;
    const msUpdateRes = await milestonePATCH(
      req(`/api/deals/${matchId}/milestones/${msId}`, {
        method: "PATCH",
        apiKey: aliceKey,
        body: { agent_id: "alice-agent", status: "completed" },
      }),
      { params: Promise.resolve({ matchId, milestoneId: String(msId) }) }
    );
    expect(msUpdateRes.status).toBe(200);

    // === Phase 5b: Complete deal (both parties) ===
    const completeAlice = await completePOST(
      req(`/api/deals/${matchId}/complete`, {
        apiKey: aliceKey,
        body: { agent_id: "alice-agent" },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(completeAlice.status).toBe(200);
    const completeAliceData = await completeAlice.json();
    expect(completeAliceData.status).toBe("waiting");

    const completeBob = await completePOST(
      req(`/api/deals/${matchId}/complete`, {
        apiKey: bobKey,
        body: { agent_id: "bob-agent" },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(completeBob.status).toBe(200);
    const completeBobData = await completeBob.json();
    expect(completeBobData.status).toBe("completed");

    // === Post-deal: Leave reviews ===
    // Skill doc: POST /api/reputation/{counterpart_agent_id}/review
    const reviewRes = await reputationPOST(
      req(`/api/reputation/bob-agent/review`, {
        apiKey: aliceKey,
        body: {
          match_id: matchId,
          rating: 5,
          comment: "Excellent collaboration, delivered on time",
        },
      }),
      { params: Promise.resolve({ agentId: "bob-agent" }) }
    );
    expect([200, 201]).toContain(reviewRes.status);

    // Bob reviews alice
    await reputationPOST(
      req(`/api/reputation/alice-agent/review`, {
        apiKey: bobKey,
        body: { match_id: matchId, rating: 4, comment: "Great developer" },
      }),
      { params: Promise.resolve({ agentId: "alice-agent" }) }
    );

    // === Check reputation (skill doc format) ===
    const repRes = await reputationGET(
      req(`/api/reputation/alice-agent`),
      { params: Promise.resolve({ agentId: "alice-agent" }) }
    );
    expect(repRes.status).toBe(200);
    const repData = await repRes.json();
    expect(repData).toHaveProperty("agent_id", "alice-agent");
    expect(repData).toHaveProperty("avg_rating");
    expect(repData).toHaveProperty("total_reviews", 1);
    expect(repData).toHaveProperty("rating_breakdown");
    expect(repData).toHaveProperty("recent_reviews");

    // === Portfolio endpoint ===
    const portfolioRes = await portfolioGET(
      req(`/api/agents/alice-agent/portfolio`),
      { params: Promise.resolve({ agentId: "alice-agent" }) }
    );
    expect(portfolioRes.status).toBe(200);
    const portfolioData = await portfolioRes.json();
    expect(portfolioData).toHaveProperty("agent_id", "alice-agent");

    // === Activity feed ===
    const actRes = await activityGET(
      req(`/api/activity?agent_id=alice-agent`, { apiKey: aliceKey })
    );
    expect(actRes.status).toBe(200);
    const actData = await actRes.json();
    expect(actData).toHaveProperty("events");
    expect(actData.events.length).toBeGreaterThan(0);
  });

  it("Deal cancellation matches skill doc format", async () => {
    // Set up two agents and a match
    const carolKey = await getApiKey("carol-agent");
    const daveKey = await getApiKey("dave-agent");

    await connectPOST(req("/api/connect", {
      apiKey: carolKey,
      body: { agent_id: "carol-agent", side: "offering", category: "design", params: { skills: ["Figma"] }, description: "Designer" },
    }));
    const daveRes = await connectPOST(req("/api/connect", {
      apiKey: daveKey,
      body: { agent_id: "dave-agent", side: "seeking", category: "design", params: { skills: ["Figma"] }, description: "Need design work" },
    }));
    const daveProfile = (await daveRes.json()).profile_id;

    // Find match
    const matchRes = await matchesGET(
      req(`/api/matches/${daveProfile}`),
      { params: Promise.resolve({ profileId: daveProfile }) }
    );
    const matchId = (await matchRes.json()).matches[0].match_id;

    // Cancel - skill doc: { status: "cancelled", message: "...", counterpart_agent_id: "..." }
    const cancelRes = await cancelPOST(
      req(`/api/deals/${matchId}/cancel`, {
        apiKey: carolKey,
        body: { agent_id: "carol-agent", reason: "Found a better match" },
      }),
      { params: Promise.resolve({ matchId }) }
    );
    expect(cancelRes.status).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.status).toBe("cancelled");
    expect(cancelData).toHaveProperty("message");
    expect(cancelData).toHaveProperty("counterpart_agent_id");
  });

  it("Webhook registration and management matches skill doc", async () => {
    // Register webhook - skill doc: { url, events }
    const regRes = await webhooksPOST(
      req("/api/webhooks", {
        apiKey: aliceKey,
        body: {
          agent_id: "alice-agent",
          url: "https://my-agent.example.com/webhook",
          events: ["new_match", "message_received", "deal_approved"],
        },
      })
    );
    expect(regRes.status).toBe(200);
    const regData = await regRes.json();
    // Skill doc promises: { webhook_id, url, secret, events, message }
    expect(regData).toHaveProperty("webhook_id");
    expect(regData).toHaveProperty("url");
    expect(regData).toHaveProperty("secret");
    expect(regData).toHaveProperty("events");
    expect(regData).toHaveProperty("message");

    // List webhooks
    const listRes = await webhooksGET(
      req(`/api/webhooks?agent_id=alice-agent`, { apiKey: aliceKey })
    );
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData).toHaveProperty("webhooks");
    expect(listData.webhooks.length).toBe(1);

    // Update webhook
    const whId = regData.webhook_id;
    const patchRes = await webhookPATCH(
      req(`/api/webhooks/${whId}`, {
        method: "PATCH",
        apiKey: aliceKey,
        body: { agent_id: "alice-agent", url: "https://new-url.example.com/hook" },
      }),
      { params: Promise.resolve({ id: whId }) }
    );
    expect(patchRes.status).toBe(200);

    // Delete webhook
    const delRes = await webhookDELETE(
      req(`/api/webhooks/${whId}`, { method: "DELETE", apiKey: aliceKey, body: { agent_id: "alice-agent" } }),
      { params: Promise.resolve({ id: whId }) }
    );
    expect(delRes.status).toBe(200);
  });

  it("Profile view/update and availability matches skill doc", async () => {
    const res = await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: { agent_id: "alice-agent", side: "offering", category: "consulting", params: { skills: ["Strategy"] }, description: "Consultant" },
    }));
    const profileId = (await res.json()).profile_id;

    // View profile (public GET) - returns flat profile object (no wrapper)
    const viewRes = await profileGET(
      req(`/api/profiles/${profileId}`),
      { params: Promise.resolve({ profileId }) }
    );
    expect(viewRes.status).toBe(200);
    const viewData = await viewRes.json();
    expect(viewData).toHaveProperty("id", profileId);
    expect(viewData).toHaveProperty("availability");

    // Set availability - skill doc: PATCH with { agent_id, availability }
    const patchRes = await profilePATCH(
      req(`/api/profiles/${profileId}`, {
        method: "PATCH",
        apiKey: aliceKey,
        body: { agent_id: "alice-agent", availability: "busy" },
      }),
      { params: Promise.resolve({ profileId }) }
    );
    expect(patchRes.status).toBe(200);

    // Verify it changed
    const viewRes2 = await profileGET(
      req(`/api/profiles/${profileId}`),
      { params: Promise.resolve({ profileId }) }
    );
    const viewData2 = await viewRes2.json();
    expect(viewData2.availability).toBe("busy");

    // View agent's profiles
    const agentProfilesRes = await connectAgentGET(
      req(`/api/connect/alice-agent`),
      { params: Promise.resolve({ agentId: "alice-agent" }) }
    );
    expect(agentProfilesRes.status).toBe(200);
  });

  it("Deactivate profiles matches skill doc", async () => {
    await connectPOST(req("/api/connect", {
      apiKey: aliceKey,
      body: { agent_id: "alice-agent", side: "offering", category: "data", params: { skills: ["Python"] }, description: "Data eng" },
    }));

    // Deactivate all profiles - skill doc: DELETE /api/connect?agent_id=xxx
    const delRes = await connectDELETE(
      req(`/api/connect?agent_id=alice-agent`, { method: "DELETE", apiKey: aliceKey })
    );
    expect(delRes.status).toBe(200);
  });

  it("Inbox: mark as read matches skill doc format", async () => {
    // Skill doc: POST /api/inbox/read with { agent_id, notification_ids: [1,2,3] }
    const readRes = await inboxReadPOST(
      req("/api/inbox/read", {
        apiKey: aliceKey,
        body: { agent_id: "alice-agent" }, // mark all as read
      })
    );
    expect(readRes.status).toBe(200);
  });

  it("Custom deal template creation matches skill doc", async () => {
    const res = await templatePOST(
      req("/api/templates", {
        apiKey: aliceKey,
        body: {
          agent_id: "alice-agent",
          name: "Quick Review",
          category: "freelance-dev",
          side: "offering",
          description: "Fast code review engagement",
          suggested_terms: { rate: 50, duration_weeks: 1 },
        },
      })
    );
    expect([200, 201]).toContain(res.status);
    const data = await res.json();
    expect(data).toHaveProperty("template_id");
  });
});
