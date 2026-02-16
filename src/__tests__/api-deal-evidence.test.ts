import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as startPOST } from "@/app/api/deals/[matchId]/start/route";
import { POST as completePOST } from "@/app/api/deals/[matchId]/complete/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { POST as dealsPOST } from "@/app/api/deals/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { GET as evidenceGET } from "@/app/api/deals/[matchId]/evidence/route";
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

afterEach(() => restore());

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

const rp = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

async function createInProgressDeal(): Promise<string> {
  // Create profiles
  await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: "alice",
        side: "offering",
        category: "development",
        params: { skills: ["TypeScript"], rate_min: 50, rate_max: 100 },
      },
      aliceKey,
    ),
  );
  await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: "bob",
        side: "seeking",
        category: "development",
        params: { skills: ["TypeScript"], rate_min: 50, rate_max: 100 },
      },
      bobKey,
    ),
  );

  // Start deal
  const dealRes = await dealsPOST(
    jsonReq("/api/deals", { agent_id: "alice", counterpart_agent_id: "bob" }, aliceKey),
  );
  const { match_id } = await dealRes.json();

  // Propose
  await messagesPOST(
    jsonReq(
      `/api/deals/${match_id}/messages`,
      {
        agent_id: "alice",
        content: "Let's do it",
        message_type: "proposal",
        proposed_terms: { rate: 75 },
      },
      aliceKey,
    ),
    rp(match_id),
  );

  // Both approve
  await approvePOST(
    jsonReq(`/api/deals/${match_id}/approve`, { agent_id: "alice", approved: true }, aliceKey),
    rp(match_id),
  );
  await approvePOST(
    jsonReq(`/api/deals/${match_id}/approve`, { agent_id: "bob", approved: true }, bobKey),
    rp(match_id),
  );

  // Start
  await startPOST(
    jsonReq(`/api/deals/${match_id}/start`, { agent_id: "alice" }, aliceKey),
    rp(match_id),
  );

  return match_id;
}

describe("Deal evidence/completion", () => {
  it("accepts evidence with completion", async () => {
    const matchId = await createInProgressDeal();

    const res = await completePOST(
      jsonReq(
        `/api/deals/${matchId}/complete`,
        {
          agent_id: "alice",
          evidence: "PR merged: https://github.com/repo/pull/42, deployed to production",
        },
        aliceKey,
      ),
      rp(matchId),
    );
    const data = await res.json();
    expect(data.status).toBe("waiting");
  });

  it("completes with evidence from both parties", async () => {
    const matchId = await createInProgressDeal();

    await completePOST(
      jsonReq(
        `/api/deals/${matchId}/complete`,
        {
          agent_id: "alice",
          evidence: "Code delivered: https://github.com/repo/pull/42",
        },
        aliceKey,
      ),
      rp(matchId),
    );

    const res = await completePOST(
      jsonReq(
        `/api/deals/${matchId}/complete`,
        {
          agent_id: "bob",
          evidence: "Confirmed working, payment sent",
        },
        bobKey,
      ),
      rp(matchId),
    );
    const data = await res.json();
    expect(data.status).toBe("completed");
  });

  it("GET /evidence returns completion records", async () => {
    const matchId = await createInProgressDeal();

    await completePOST(
      jsonReq(
        `/api/deals/${matchId}/complete`,
        {
          agent_id: "alice",
          evidence: "Work done: PR #42",
        },
        aliceKey,
      ),
      rp(matchId),
    );

    const res = await evidenceGET(
      jsonReq(`/api/deals/${matchId}/evidence`, undefined, aliceKey),
      rp(matchId),
    );
    const data = await res.json();
    expect(data.completions).toHaveLength(1);
    expect(data.completions[0].evidence).toBe("Work done: PR #42");
    expect(data.both_confirmed).toBe(false);
  });

  it("shows both_confirmed after both complete", async () => {
    const matchId = await createInProgressDeal();

    await completePOST(
      jsonReq(
        `/api/deals/${matchId}/complete`,
        {
          agent_id: "alice",
          evidence: "Done",
        },
        aliceKey,
      ),
      rp(matchId),
    );
    await completePOST(
      jsonReq(
        `/api/deals/${matchId}/complete`,
        {
          agent_id: "bob",
          evidence: "Confirmed",
        },
        bobKey,
      ),
      rp(matchId),
    );

    const res = await evidenceGET(
      jsonReq(`/api/deals/${matchId}/evidence`, undefined, bobKey),
      rp(matchId),
    );
    const data = await res.json();
    expect(data.completions).toHaveLength(2);
    expect(data.both_confirmed).toBe(true);
    expect(data.status).toBe("completed");
  });

  it("rejects non-participant from viewing evidence", async () => {
    const matchId = await createInProgressDeal();
    const charlieKey = await createApiKey("charlie");
    const res = await evidenceGET(
      jsonReq(`/api/deals/${matchId}/evidence`, undefined, charlieKey),
      rp(matchId),
    );
    expect(res.status).toBe(403);
  });
});
