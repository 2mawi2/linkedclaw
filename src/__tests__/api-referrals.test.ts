import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import {
  GET as referralsGET,
  POST as referralsPOST,
  PATCH as referralsPATCH,
} from "@/app/api/referrals/route";
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
  return createApiKey(agentId);
}

describe("POST /api/referrals", () => {
  it("creates a referral", async () => {
    const aliceKey = await getApiKey("alice");
    await getApiKey("bob"); // ensure bob exists

    const req = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({
        referred_agent_id: "bob",
        reason: "Great at React work",
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    const res = await referralsPOST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.referral_id).toMatch(/^ref_/);
  });

  it("requires auth", async () => {
    const req = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "bob" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await referralsPOST(req);
    expect(res.status).toBe(401);
  });

  it("rejects self-referral", async () => {
    const key = await getApiKey("alice");

    const req = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "alice" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
    });
    const res = await referralsPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("yourself");
  });

  it("rejects referral to non-existent agent", async () => {
    const key = await getApiKey("alice");

    const req = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "nonexistent" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
    });
    const res = await referralsPOST(req);
    expect(res.status).toBe(404);
  });

  it("requires referred_agent_id", async () => {
    const key = await getApiKey("alice");

    const req = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ reason: "great dev" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
    });
    const res = await referralsPOST(req);
    expect(res.status).toBe(400);
  });

  it("prevents duplicate pending referrals", async () => {
    const aliceKey = await getApiKey("alice");
    await getApiKey("bob");

    const makeReq = () =>
      new NextRequest("http://localhost:3000/api/referrals", {
        method: "POST",
        body: JSON.stringify({ referred_agent_id: "bob" }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceKey}`,
        },
      });

    const res1 = await referralsPOST(makeReq());
    expect(res1.status).toBe(201);

    const res2 = await referralsPOST(makeReq());
    expect(res2.status).toBe(409);
  });

  it("creates notification for referred agent", async () => {
    const aliceKey = await getApiKey("alice");
    await getApiKey("bob");

    const req = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({
        referred_agent_id: "bob",
        reason: "Expert in Rust",
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    await referralsPOST(req);

    const notifs = await db.execute({
      sql: "SELECT * FROM notifications WHERE agent_id = 'bob' AND type = 'referral'",
      args: [],
    });
    expect(notifs.rows.length).toBe(1);
    expect(notifs.rows[0].summary).toContain("alice");
    expect(notifs.rows[0].summary).toContain("Expert in Rust");
  });
});

describe("GET /api/referrals", () => {
  it("returns received referrals for authenticated agent", async () => {
    const aliceKey = await getApiKey("alice");
    const bobKey = await getApiKey("bob");

    // Alice refers bob
    const createReq = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "bob", reason: "Good dev" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    await referralsPOST(createReq);

    // Bob lists received referrals
    const req = new NextRequest("http://localhost:3000/api/referrals", {
      headers: { Authorization: `Bearer ${bobKey}` },
    });
    const res = await referralsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.referrals.length).toBe(1);
    expect(data.referrals[0].referrer_agent_id).toBe("alice");
    expect(data.referrals[0].reason).toBe("Good dev");
  });

  it("returns sent referrals with direction=sent", async () => {
    const aliceKey = await getApiKey("alice");
    await getApiKey("bob");

    const createReq = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "bob" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    await referralsPOST(createReq);

    const req = new NextRequest("http://localhost:3000/api/referrals?direction=sent", {
      headers: { Authorization: `Bearer ${aliceKey}` },
    });
    const res = await referralsGET(req);
    const data = await res.json();
    expect(data.referrals.length).toBe(1);
    expect(data.referrals[0].referred_agent_id).toBe("bob");
  });

  it("allows public lookup by agent_id", async () => {
    const aliceKey = await getApiKey("alice");
    await getApiKey("bob");

    const createReq = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "bob" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    await referralsPOST(createReq);

    // No auth, just agent_id
    const req = new NextRequest("http://localhost:3000/api/referrals?agent_id=bob");
    const res = await referralsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.referrals.length).toBe(1);
  });

  it("requires auth or agent_id", async () => {
    const req = new NextRequest("http://localhost:3000/api/referrals");
    const res = await referralsGET(req);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/referrals", () => {
  it("accepts a referral", async () => {
    const aliceKey = await getApiKey("alice");
    const bobKey = await getApiKey("bob");

    const createReq = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "bob" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    const createRes = await referralsPOST(createReq);
    const { referral_id } = await createRes.json();

    const req = new NextRequest(`http://localhost:3000/api/referrals?id=${referral_id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bobKey}`,
      },
    });
    const res = await referralsPATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("accepted");
  });

  it("declines a referral", async () => {
    const aliceKey = await getApiKey("alice");
    const bobKey = await getApiKey("bob");

    const createReq = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "bob" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    const createRes = await referralsPOST(createReq);
    const { referral_id } = await createRes.json();

    const req = new NextRequest(`http://localhost:3000/api/referrals?id=${referral_id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "declined" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bobKey}`,
      },
    });
    const res = await referralsPATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("declined");
  });

  it("only the referred agent can update", async () => {
    const aliceKey = await getApiKey("alice");
    await getApiKey("bob");

    const createReq = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "bob" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    const createRes = await referralsPOST(createReq);
    const { referral_id } = await createRes.json();

    // Alice tries to accept (she's the referrer, not the referred)
    const req = new NextRequest(`http://localhost:3000/api/referrals?id=${referral_id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    const res = await referralsPATCH(req);
    expect(res.status).toBe(403);
  });

  it("rejects already resolved referrals", async () => {
    const aliceKey = await getApiKey("alice");
    const bobKey = await getApiKey("bob");

    const createReq = new NextRequest("http://localhost:3000/api/referrals", {
      method: "POST",
      body: JSON.stringify({ referred_agent_id: "bob" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceKey}`,
      },
    });
    const createRes = await referralsPOST(createReq);
    const { referral_id } = await createRes.json();

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/referrals?id=${referral_id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "accepted" }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobKey}`,
        },
      });

    await referralsPATCH(makeReq());
    const res = await referralsPATCH(makeReq());
    expect(res.status).toBe(409);
  });

  it("requires id query parameter", async () => {
    const key = await getApiKey("alice");
    const req = new NextRequest("http://localhost:3000/api/referrals", {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
    });
    const res = await referralsPATCH(req);
    expect(res.status).toBe(400);
  });

  it("validates status value", async () => {
    const key = await getApiKey("alice");
    const req = new NextRequest("http://localhost:3000/api/referrals?id=ref_123", {
      method: "PATCH",
      body: JSON.stringify({ status: "invalid" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
    });
    const res = await referralsPATCH(req);
    expect(res.status).toBe(400);
  });
});
