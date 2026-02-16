import { describe, test, expect, beforeAll } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { GET } from "@/app/api/deals/[matchId]/stream/route";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createApiKey } from "./test-helpers";

async function setupDealScenario() {
  const db = createTestDb();
  _setDb(db);
  await migrate(db);
  const agentA = `stream-a-${Date.now()}`;
  const agentB = `stream-b-${Date.now()}`;

  const apiKeyA = await createApiKey(agentA);
  const apiKeyB = await createApiKey(agentB);

  // Create profiles
  const profileA = randomUUID();
  const profileB = randomUUID();
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, 'offering', 'development', '{}')",
    args: [profileA, agentA],
  });
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, 'seeking', 'development', '{}')",
    args: [profileB, agentB],
  });

  // Create match
  const matchId = randomUUID();
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status)
          VALUES (?, ?, ?, '{"matching_skills":[],"rate_overlap":null,"remote_compatible":false,"score":50}', 'matched')`,
    args: [matchId, profileA, profileB],
  });

  return { db, matchId, agentA, agentB, apiKeyA, apiKeyB };
}

function makeReq(matchId: string, apiKey: string, afterId = 0): NextRequest {
  return new NextRequest(`http://localhost:3000/api/deals/${matchId}/stream?after_id=${afterId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

describe("Deal SSE Stream", () => {
  let scenario: Awaited<ReturnType<typeof setupDealScenario>>;

  beforeAll(async () => {
    scenario = await setupDealScenario();
  });

  test("returns 401 without auth", async () => {
    const req = new NextRequest(`http://localhost:3000/api/deals/${scenario.matchId}/stream`);
    const res = await GET(req, { params: Promise.resolve({ matchId: scenario.matchId }) });
    expect(res.status).toBe(401);
  });

  test("returns 404 for non-existent deal", async () => {
    const req = makeReq("non-existent", scenario.apiKeyA);
    const res = await GET(req, { params: Promise.resolve({ matchId: "non-existent" }) });
    expect(res.status).toBe(404);
  });

  test("returns 403 for non-participant", async () => {
    const outsiderKey = await createApiKey(`outsider-${Date.now()}`);
    const req = makeReq(scenario.matchId, outsiderKey);
    const res = await GET(req, { params: Promise.resolve({ matchId: scenario.matchId }) });
    expect(res.status).toBe(403);
  });

  test("returns SSE stream for participant", async () => {
    const req = makeReq(scenario.matchId, scenario.apiKeyA);
    const res = await GET(req, { params: Promise.resolve({ matchId: scenario.matchId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");

    const reader = res.body?.getReader();
    await reader?.cancel();
  });

  test("both participants can connect", async () => {
    const reqB = makeReq(scenario.matchId, scenario.apiKeyB);
    const resB = await GET(reqB, { params: Promise.resolve({ matchId: scenario.matchId }) });
    expect(resB.status).toBe(200);
    expect(resB.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = resB.body?.getReader();
    await reader?.cancel();
  });

  test("streams new messages to participant", async () => {
    const { db, matchId, agentA, apiKeyA } = scenario;

    const req = makeReq(matchId, apiKeyA);
    const res = await GET(req, { params: Promise.resolve({ matchId }) });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Insert a message after a short delay
    await new Promise((r) => setTimeout(r, 100));
    await db.execute({
      sql: "INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, 'negotiation')",
      args: [matchId, agentA, "SSE test message"],
    });

    // Read from the stream until we get a message event (within 5s)
    let received = "";
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) =>
          setTimeout(() => r({ value: undefined, done: true }), 3000),
        ),
      ]);
      if (done || !value) break;
      received += decoder.decode(value, { stream: true });
      if (received.includes("event: message")) break;
    }

    await reader.cancel();

    expect(received).toContain("event: message");
    expect(received).toContain("SSE test message");
  });
});
