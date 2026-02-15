import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET as templatesGET, POST as templatesPOST } from "@/app/api/templates/route";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;

async function getApiKey(agentId: string): Promise<string> { return createApiKey(agentId); }

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
});

afterEach(() => {
  restore();
});

describe("GET /api/templates", () => {
  it("returns built-in templates", async () => {
    const req = new NextRequest("http://localhost:3000/api/templates");
    const res = await templatesGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templates.length).toBeGreaterThanOrEqual(6);
    expect(data.templates.every((t: { built_in: boolean }) => t.built_in === true)).toBe(true);
  });

  it("includes agent-to-agent collaboration template", async () => {
    const req = new NextRequest("http://localhost:3000/api/templates?category=agent-services");
    const res = await templatesGET(req);
    const data = await res.json();
    expect(data.templates.length).toBe(1);
    expect(data.templates[0].name).toBe("Agent-to-Agent Collaboration");
  });

  it("filters by category", async () => {
    const req = new NextRequest("http://localhost:3000/api/templates?category=consulting");
    const res = await templatesGET(req);
    const data = await res.json();
    expect(data.templates.length).toBeGreaterThanOrEqual(1);
    expect(data.templates.every((t: { category: string }) => t.category === "consulting")).toBe(true);
  });

  it("returns empty for unknown category", async () => {
    const req = new NextRequest("http://localhost:3000/api/templates?category=nonexistent");
    const res = await templatesGET(req);
    const data = await res.json();
    expect(data.templates.length).toBe(0);
  });

  it("includes custom templates when agent_id provided", async () => {
    const key = await getApiKey("alice");

    const createReq = new NextRequest("http://localhost:3000/api/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "My Custom Template",
        category: "freelance-dev",
        side: "offering",
        description: "Custom dev template",
        suggested_params: { skills: ["rust"] },
        suggested_terms: { type: "project", rate: 100 },
      }),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
    });
    await templatesPOST(createReq);

    const req = new NextRequest("http://localhost:3000/api/templates?agent_id=alice");
    const res = await templatesGET(req);
    const data = await res.json();

    const custom = data.templates.filter((t: { built_in: boolean }) => !t.built_in);
    expect(custom.length).toBe(1);
    expect(custom[0].name).toBe("My Custom Template");
    expect(custom[0].suggested_params.skills).toEqual(["rust"]);
  });
});

describe("POST /api/templates", () => {
  it("creates a custom template", async () => {
    const key = await getApiKey("alice");
    const req = new NextRequest("http://localhost:3000/api/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Security Audit",
        category: "security",
        side: "offering",
        description: "Comprehensive security review",
        suggested_params: { skills: ["security", "pentesting"] },
        suggested_terms: { type: "project", typical_rate_range: { min: 2000, max: 10000 } },
      }),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
    });
    const res = await templatesPOST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.template_id).toMatch(/^tpl_/);
  });

  it("requires authentication", async () => {
    const req = new NextRequest("http://localhost:3000/api/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Test",
        category: "test",
        side: "offering",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await templatesPOST(req);
    expect(res.status).toBe(401);
  });

  it("validates required fields", async () => {
    const key = await getApiKey("bob");
    const req = new NextRequest("http://localhost:3000/api/templates", {
      method: "POST",
      body: JSON.stringify({ category: "test", side: "offering" }),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
    });
    const res = await templatesPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("name");
  });

  it("validates side field", async () => {
    const key = await getApiKey("charlie");
    const req = new NextRequest("http://localhost:3000/api/templates", {
      method: "POST",
      body: JSON.stringify({ name: "Test", category: "test", side: "invalid" }),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
    });
    const res = await templatesPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("side");
  });
});
