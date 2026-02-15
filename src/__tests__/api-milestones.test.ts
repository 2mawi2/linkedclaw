import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as keysPOST } from "@/app/api/keys/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { GET as milestonesGET, POST as milestonesPOST } from "@/app/api/deals/[matchId]/milestones/route";
import { PATCH as milestonePATCH } from "@/app/api/deals/[matchId]/milestones/[milestoneId]/route";
import { NextRequest } from "next/server";

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

async function getApiKey(agentId: string): Promise<string> {
  const req = new NextRequest("http://localhost:3000/api/keys", {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await keysPOST(req);
  const data = await res.json();
  return data.api_key;
}

async function createProfile(agentId: string, side: string, category: string, params: Record<string, unknown>, apiKey: string) {
  const req = new NextRequest("http://localhost:3000/api/connect", {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId, side, category, params, description: `${agentId} profile` }),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  });
  const res = await connectPOST(req);
  return res.json();
}

async function getMatches(profileId: string) {
  const req = new NextRequest(`http://localhost:3000/api/matches/${profileId}`, { method: "GET" });
  const res = await matchesGET(req, { params: Promise.resolve({ profileId }) });
  return res.json();
}

async function setupDealInProgress() {
  const keyA = await getApiKey("agent-a");
  const keyB = await getApiKey("agent-b");
  const profileA = await createProfile("agent-a", "offering", "dev", { skills: ["typescript"] }, keyA);
  await createProfile("agent-b", "seeking", "dev", { skills: ["typescript"] }, keyB);

  const matchData = await getMatches(profileA.profile_id);
  const matchId = matchData.matches[0].match_id;

  // Move deal to negotiating by sending a message
  const msgReq = new NextRequest(`http://localhost:3000/api/deals/${matchId}/messages`, {
    method: "POST",
    body: JSON.stringify({ agent_id: "agent-a", content: "Let's work together", message_type: "negotiation" }),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
  });
  await messagesPOST(msgReq, { params: Promise.resolve({ matchId }) });

  return { matchId, keyA, keyB };
}

function milestoneRequest(matchId: string, body: unknown, apiKey: string) {
  return new NextRequest(`http://localhost:3000/api/deals/${matchId}/milestones`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  });
}

function patchMilestoneRequest(matchId: string, milestoneId: string, body: unknown, apiKey: string) {
  return new NextRequest(`http://localhost:3000/api/deals/${matchId}/milestones/${milestoneId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  });
}

function getMilestonesRequest(matchId: string) {
  return new NextRequest(`http://localhost:3000/api/deals/${matchId}/milestones`, { method: "GET" });
}

describe("Deal Milestones", () => {
  it("creates milestones for a deal", async () => {
    const { matchId, keyA } = await setupDealInProgress();

    const req = milestoneRequest(matchId, {
      agent_id: "agent-a",
      milestones: [
        { title: "Phase 1: Setup", description: "Set up project scaffolding" },
        { title: "Phase 2: Core", description: "Implement core features" },
        { title: "Phase 3: Deploy", description: "Deploy to production" },
      ],
    }, keyA);

    const res = await milestonesPOST(req, { params: Promise.resolve({ matchId }) });
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.milestones).toHaveLength(3);
    expect(data.milestones[0].title).toBe("Phase 1: Setup");
    expect(data.milestones[0].status).toBe("pending");
  });

  it("lists milestones with progress", async () => {
    const { matchId, keyA } = await setupDealInProgress();

    // Create milestones
    const createReq = milestoneRequest(matchId, {
      agent_id: "agent-a",
      milestones: [
        { title: "Step 1" },
        { title: "Step 2" },
      ],
    }, keyA);
    await milestonesPOST(createReq, { params: Promise.resolve({ matchId }) });

    // List them
    const getReq = getMilestonesRequest(matchId);
    const res = await milestonesGET(getReq, { params: Promise.resolve({ matchId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.milestones).toHaveLength(2);
    expect(data.total).toBe(2);
    expect(data.completed).toBe(0);
    expect(data.progress).toBe(0);
  });

  it("updates milestone status", async () => {
    const { matchId, keyA } = await setupDealInProgress();

    // Create a milestone
    const createReq = milestoneRequest(matchId, {
      agent_id: "agent-a",
      milestones: [{ title: "Task 1" }],
    }, keyA);
    const createRes = await milestonesPOST(createReq, { params: Promise.resolve({ matchId }) });
    const created = await createRes.json();
    const milestoneId = created.milestones[0].id;

    // Update it
    const patchReq = patchMilestoneRequest(matchId, milestoneId, {
      agent_id: "agent-a",
      status: "in_progress",
    }, keyA);
    const res = await milestonePATCH(patchReq, { params: Promise.resolve({ matchId, milestoneId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.milestone.status).toBe("in_progress");
  });

  it("counterpart can update milestones", async () => {
    const { matchId, keyA, keyB } = await setupDealInProgress();

    // Agent A creates milestone
    const createReq = milestoneRequest(matchId, {
      agent_id: "agent-a",
      milestones: [{ title: "Shared task" }],
    }, keyA);
    const created = await (await milestonesPOST(createReq, { params: Promise.resolve({ matchId }) })).json();
    const milestoneId = created.milestones[0].id;

    // Agent B updates it
    const patchReq = patchMilestoneRequest(matchId, milestoneId, {
      agent_id: "agent-b",
      status: "completed",
    }, keyB);
    const res = await milestonePATCH(patchReq, { params: Promise.resolve({ matchId, milestoneId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.milestone.status).toBe("completed");
  });

  it("rejects milestones from non-participant", async () => {
    const { matchId } = await setupDealInProgress();
    const keyC = await getApiKey("agent-c");

    const req = milestoneRequest(matchId, {
      agent_id: "agent-c",
      milestones: [{ title: "Intruder task" }],
    }, keyC);
    const res = await milestonesPOST(req, { params: Promise.resolve({ matchId }) });
    expect(res.status).toBe(403);
  });

  it("rejects milestones without auth", async () => {
    const { matchId } = await setupDealInProgress();

    const req = new NextRequest(`http://localhost:3000/api/deals/${matchId}/milestones`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "agent-a", milestones: [{ title: "No auth" }] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await milestonesPOST(req, { params: Promise.resolve({ matchId }) });
    expect(res.status).toBe(401);
  });

  it("rejects invalid milestone status", async () => {
    const { matchId, keyA } = await setupDealInProgress();

    const createReq = milestoneRequest(matchId, {
      agent_id: "agent-a",
      milestones: [{ title: "Task" }],
    }, keyA);
    const created = await (await milestonesPOST(createReq, { params: Promise.resolve({ matchId }) })).json();
    const milestoneId = created.milestones[0].id;

    const patchReq = patchMilestoneRequest(matchId, milestoneId, {
      agent_id: "agent-a",
      status: "invalid_status",
    }, keyA);
    const res = await milestonePATCH(patchReq, { params: Promise.resolve({ matchId, milestoneId }) });
    expect(res.status).toBe(400);
  });

  it("enforces max 20 milestones per deal", async () => {
    const { matchId, keyA } = await setupDealInProgress();

    // Create 20 milestones
    const milestones = Array.from({ length: 20 }, (_, i) => ({ title: `Task ${i + 1}` }));
    const req = milestoneRequest(matchId, { agent_id: "agent-a", milestones }, keyA);
    const res = await milestonesPOST(req, { params: Promise.resolve({ matchId }) });
    expect(res.status).toBe(201);

    // Try to add one more
    const req2 = milestoneRequest(matchId, { agent_id: "agent-a", milestones: [{ title: "One too many" }] }, keyA);
    const res2 = await milestonesPOST(req2, { params: Promise.resolve({ matchId }) });
    expect(res2.status).toBe(400);
  });

  it("shows progress when milestones are completed", async () => {
    const { matchId, keyA } = await setupDealInProgress();

    // Create 4 milestones
    const createReq = milestoneRequest(matchId, {
      agent_id: "agent-a",
      milestones: [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }],
    }, keyA);
    const created = await (await milestonesPOST(createReq, { params: Promise.resolve({ matchId }) })).json();

    // Complete 2 of them
    for (const m of created.milestones.slice(0, 2)) {
      const req = patchMilestoneRequest(matchId, m.id, { agent_id: "agent-a", status: "completed" }, keyA);
      await milestonePATCH(req, { params: Promise.resolve({ matchId, milestoneId: m.id }) });
    }

    // Check progress
    const getReq = getMilestonesRequest(matchId);
    const res = await milestonesGET(getReq, { params: Promise.resolve({ matchId }) });
    const data = await res.json();

    expect(data.completed).toBe(2);
    expect(data.progress).toBe(50);
  });

  it("returns 404 for milestones of nonexistent deal", async () => {
    const req = getMilestonesRequest("nonexistent-deal");
    const res = await milestonesGET(req, { params: Promise.resolve({ matchId: "nonexistent-deal" }) });
    expect(res.status).toBe(404);
  });

  it("can update milestone title and description", async () => {
    const { matchId, keyA } = await setupDealInProgress();

    const createReq = milestoneRequest(matchId, {
      agent_id: "agent-a",
      milestones: [{ title: "Original title", description: "Original desc" }],
    }, keyA);
    const created = await (await milestonesPOST(createReq, { params: Promise.resolve({ matchId }) })).json();
    const milestoneId = created.milestones[0].id;

    const patchReq = patchMilestoneRequest(matchId, milestoneId, {
      agent_id: "agent-a",
      title: "Updated title",
      description: "Updated description",
    }, keyA);
    const res = await milestonePATCH(patchReq, { params: Promise.resolve({ matchId, milestoneId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.milestone.title).toBe("Updated title");
    expect(data.milestone.description).toBe("Updated description");
  });
});
