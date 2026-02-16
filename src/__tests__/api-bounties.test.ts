import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET as bountiesGET, POST as bountiesPOST } from "@/app/api/bounties/route";
import { GET as bountyDetailGET } from "@/app/api/bounties/[bountyId]/route";
import { POST as claimPOST } from "@/app/api/bounties/[bountyId]/claim/route";
import { POST as submitPOST } from "@/app/api/bounties/[bountyId]/submit/route";
import { POST as verifyPOST } from "@/app/api/bounties/[bountyId]/verify/route";
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

const routeParams = (bountyId: string) => ({ params: Promise.resolve({ bountyId }) });

async function createBounty(key: string, agentId: string, overrides?: Record<string, unknown>) {
  const res = await bountiesPOST(
    jsonReq(
      "/api/bounties",
      {
        agent_id: agentId,
        title: "Build an API integration",
        description: "Connect our service to the Stripe API for payment processing",
        category: "development",
        skills: ["TypeScript", "Stripe", "API"],
        reward_amount: 200,
        reward_currency: "EUR",
        ...overrides,
      },
      key,
    ),
  );
  return res.json();
}

describe("Bounties", () => {
  describe("POST /api/bounties", () => {
    it("creates a bounty", async () => {
      const data = await createBounty(aliceKey, "alice");
      expect(data.bounty_id).toBeDefined();
      expect(data.status).toBe("open");
    });

    it("rejects unauthenticated requests", async () => {
      const res = await bountiesPOST(
        jsonReq("/api/bounties", {
          agent_id: "alice",
          title: "test",
          description: "test",
          category: "dev",
        }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects mismatched agent_id", async () => {
      const res = await bountiesPOST(
        jsonReq(
          "/api/bounties",
          { agent_id: "bob", title: "test", description: "test", category: "dev" },
          aliceKey,
        ),
      );
      expect(res.status).toBe(403);
    });

    it("requires title, description, category", async () => {
      const res = await bountiesPOST(jsonReq("/api/bounties", { agent_id: "alice" }, aliceKey));
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/bounties", () => {
    it("lists open bounties", async () => {
      await createBounty(aliceKey, "alice");
      await createBounty(aliceKey, "alice", { title: "Second bounty" });
      const res = await bountiesGET(jsonReq("/api/bounties"));
      const data = await res.json();
      expect(data.bounties).toHaveLength(2);
      expect(data.count).toBe(2);
    });

    it("filters by category", async () => {
      await createBounty(aliceKey, "alice", { category: "development" });
      await createBounty(aliceKey, "alice", { category: "design", title: "Design logo" });
      const res = await bountiesGET(jsonReq("/api/bounties?category=design"));
      const data = await res.json();
      expect(data.bounties).toHaveLength(1);
      expect(data.bounties[0].title).toBe("Design logo");
    });

    it("filters by creator", async () => {
      await createBounty(aliceKey, "alice");
      await createBounty(bobKey, "bob", { title: "Bob's bounty" });
      const res = await bountiesGET(jsonReq("/api/bounties?creator=bob"));
      const data = await res.json();
      expect(data.bounties).toHaveLength(1);
    });
  });

  describe("GET /api/bounties/:id", () => {
    it("returns bounty details", async () => {
      const created = await createBounty(aliceKey, "alice");
      const res = await bountyDetailGET(
        jsonReq(`/api/bounties/${created.bounty_id}`),
        routeParams(created.bounty_id),
      );
      const data = await res.json();
      expect(data.title).toBe("Build an API integration");
      expect(data.skills).toEqual(["TypeScript", "Stripe", "API"]);
    });

    it("returns 404 for missing bounty", async () => {
      const res = await bountyDetailGET(
        jsonReq("/api/bounties/nonexistent"),
        routeParams("nonexistent"),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/bounties/:id/claim", () => {
    it("allows another agent to claim", async () => {
      const created = await createBounty(aliceKey, "alice");
      const res = await claimPOST(
        jsonReq(`/api/bounties/${created.bounty_id}/claim`, { agent_id: "bob" }, bobKey),
        routeParams(created.bounty_id),
      );
      const data = await res.json();
      expect(data.status).toBe("claimed");
      expect(data.claimed_by).toBe("bob");
    });

    it("prevents claiming own bounty", async () => {
      const created = await createBounty(aliceKey, "alice");
      const res = await claimPOST(
        jsonReq(`/api/bounties/${created.bounty_id}/claim`, { agent_id: "alice" }, aliceKey),
        routeParams(created.bounty_id),
      );
      expect(res.status).toBe(400);
    });

    it("prevents double-claiming", async () => {
      const created = await createBounty(aliceKey, "alice");
      await claimPOST(
        jsonReq(`/api/bounties/${created.bounty_id}/claim`, { agent_id: "bob" }, bobKey),
        routeParams(created.bounty_id),
      );
      const charlieKey = await createApiKey("charlie");
      const res = await claimPOST(
        jsonReq(`/api/bounties/${created.bounty_id}/claim`, { agent_id: "charlie" }, charlieKey),
        routeParams(created.bounty_id),
      );
      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/bounties/:id/submit", () => {
    it("allows claimer to submit evidence", async () => {
      const created = await createBounty(aliceKey, "alice");
      await claimPOST(
        jsonReq(`/api/bounties/${created.bounty_id}/claim`, { agent_id: "bob" }, bobKey),
        routeParams(created.bounty_id),
      );
      const res = await submitPOST(
        jsonReq(
          `/api/bounties/${created.bounty_id}/submit`,
          { agent_id: "bob", evidence: "PR merged: https://github.com/example/repo/pull/42" },
          bobKey,
        ),
        routeParams(created.bounty_id),
      );
      const data = await res.json();
      expect(data.status).toBe("submitted");
    });

    it("rejects non-claimer", async () => {
      const created = await createBounty(aliceKey, "alice");
      await claimPOST(
        jsonReq(`/api/bounties/${created.bounty_id}/claim`, { agent_id: "bob" }, bobKey),
        routeParams(created.bounty_id),
      );
      const res = await submitPOST(
        jsonReq(
          `/api/bounties/${created.bounty_id}/submit`,
          { agent_id: "alice", evidence: "I did it" },
          aliceKey,
        ),
        routeParams(created.bounty_id),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/bounties/:id/verify", () => {
    async function setupSubmitted() {
      const created = await createBounty(aliceKey, "alice");
      const id = created.bounty_id;
      await claimPOST(
        jsonReq(`/api/bounties/${id}/claim`, { agent_id: "bob" }, bobKey),
        routeParams(id),
      );
      await submitPOST(
        jsonReq(
          `/api/bounties/${id}/submit`,
          { agent_id: "bob", evidence: "Done: https://github.com/pr/1" },
          bobKey,
        ),
        routeParams(id),
      );
      return id;
    }

    it("creator can approve completion", async () => {
      const id = await setupSubmitted();
      const res = await verifyPOST(
        jsonReq(`/api/bounties/${id}/verify`, { agent_id: "alice", approved: true }, aliceKey),
        routeParams(id),
      );
      const data = await res.json();
      expect(data.status).toBe("completed");
    });

    it("creator can reject and claimer can resubmit", async () => {
      const id = await setupSubmitted();
      const res1 = await verifyPOST(
        jsonReq(`/api/bounties/${id}/verify`, { agent_id: "alice", approved: false }, aliceKey),
        routeParams(id),
      );
      expect((await res1.json()).status).toBe("claimed");
      const res2 = await submitPOST(
        jsonReq(
          `/api/bounties/${id}/submit`,
          { agent_id: "bob", evidence: "Fixed: https://github.com/pr/2" },
          bobKey,
        ),
        routeParams(id),
      );
      expect((await res2.json()).status).toBe("submitted");
    });

    it("non-creator cannot verify", async () => {
      const id = await setupSubmitted();
      const res = await verifyPOST(
        jsonReq(`/api/bounties/${id}/verify`, { agent_id: "bob", approved: true }, bobKey),
        routeParams(id),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("Full lifecycle", () => {
    it("open -> claimed -> submitted -> completed", async () => {
      const created = await createBounty(aliceKey, "alice", {
        title: "Fix login bug",
        reward_amount: 50,
      });
      const id = created.bounty_id;

      // Listed
      const list = await (await bountiesGET(jsonReq("/api/bounties"))).json();
      expect(list.bounties).toHaveLength(1);
      expect(list.bounties[0].reward_amount).toBe(50);

      // Claim
      expect(
        (
          await (
            await claimPOST(
              jsonReq(`/api/bounties/${id}/claim`, { agent_id: "bob" }, bobKey),
              routeParams(id),
            )
          ).json()
        ).status,
      ).toBe("claimed");

      // Not in open list
      expect(
        (await (await bountiesGET(jsonReq("/api/bounties?status=open"))).json()).bounties,
      ).toHaveLength(0);

      // Submit
      expect(
        (
          await (
            await submitPOST(
              jsonReq(
                `/api/bounties/${id}/submit`,
                { agent_id: "bob", evidence: "Fixed in commit abc123" },
                bobKey,
              ),
              routeParams(id),
            )
          ).json()
        ).status,
      ).toBe("submitted");

      // Verify
      expect(
        (
          await (
            await verifyPOST(
              jsonReq(
                `/api/bounties/${id}/verify`,
                { agent_id: "alice", approved: true },
                aliceKey,
              ),
              routeParams(id),
            )
          ).json()
        ).status,
      ).toBe("completed");

      // Final state
      const detail = await (
        await bountyDetailGET(jsonReq(`/api/bounties/${id}`), routeParams(id))
      ).json();
      expect(detail.status).toBe("completed");
      expect(detail.completed_at).toBeDefined();
    });
  });
});
