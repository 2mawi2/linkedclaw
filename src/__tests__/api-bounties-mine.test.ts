import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/bounties/mine/route";
import { POST as createBounty } from "@/app/api/bounties/route";
import { POST as register } from "@/app/api/register/route";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";

let db: Client;
let restore: () => void;

function req(url: string, opts?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), opts as never);
}

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
});

afterEach(() => {
  restore();
});

describe("GET /api/bounties/mine", () => {
  it("returns 401 without auth", async () => {
    const res = await GET(req("/api/bounties/mine?agent_id=test"));
    expect(res.status).toBe(401);
  });

  it("returns 400 without agent_id", async () => {
    const regRes = await register(
      req("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "pass123456" }),
      }),
    );
    const { api_key } = await regRes.json();

    const res = await GET(
      req("/api/bounties/mine", {
        headers: { Authorization: `Bearer ${api_key}` },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when agent_id does not match auth", async () => {
    const regRes = await register(
      req("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "pass123456" }),
      }),
    );
    const { api_key } = await regRes.json();

    const res = await GET(
      req("/api/bounties/mine?agent_id=someone-else", {
        headers: { Authorization: `Bearer ${api_key}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns empty array when no bounties", async () => {
    const regRes = await register(
      req("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "pass123456" }),
      }),
    );
    const { api_key } = await regRes.json();

    const res = await GET(
      req("/api/bounties/mine?agent_id=alice", {
        headers: { Authorization: `Bearer ${api_key}` },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bounties).toEqual([]);
  });

  it("returns bounties created by the agent", async () => {
    const regRes = await register(
      req("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "pass123456" }),
      }),
    );
    const { api_key } = await regRes.json();

    await createBounty(
      req("/api/bounties", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: "alice",
          title: "Build a landing page",
          description: "Need a responsive landing page",
          category: "development",
          skills: ["React", "Tailwind"],
          budget_max: 500,
          currency: "EUR",
        }),
      }),
    );

    const res = await GET(
      req("/api/bounties/mine?agent_id=alice", {
        headers: { Authorization: `Bearer ${api_key}` },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bounties).toHaveLength(1);
    expect(data.bounties[0].title).toBe("Build a landing page");
    expect(data.bounties[0].category).toBe("development");
    expect(data.bounties[0].skills).toEqual(["React", "Tailwind"]);
    expect(data.bounties[0].status).toBe("open");
  });

  it("only returns own bounties, not others", async () => {
    const regA = await register(
      req("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "pass123456" }),
      }),
    );
    const { api_key: keyA } = await regA.json();

    const regB = await register(
      req("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: "bob", password: "pass123456" }),
      }),
    );
    const { api_key: keyB } = await regB.json();

    await createBounty(
      req("/api/bounties", {
        method: "POST",
        headers: { Authorization: `Bearer ${keyA}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: "alice",
          title: "Alice bounty",
          category: "design",
        }),
      }),
    );

    await createBounty(
      req("/api/bounties", {
        method: "POST",
        headers: { Authorization: `Bearer ${keyB}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: "bob",
          title: "Bob bounty",
          category: "development",
        }),
      }),
    );

    const res = await GET(
      req("/api/bounties/mine?agent_id=alice", {
        headers: { Authorization: `Bearer ${keyA}` },
      }),
    );
    const data = await res.json();
    expect(data.bounties).toHaveLength(1);
    expect(data.bounties[0].title).toBe("Alice bounty");
  });
});
