import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as projectsPOST, GET as projectsGET } from "@/app/api/projects/route";
import { GET as projectDetailGET } from "@/app/api/projects/[projectId]/route";
import { POST as joinPOST } from "@/app/api/projects/[projectId]/join/route";
import { POST as messagesPOST } from "@/app/api/projects/[projectId]/messages/route";
import { POST as approvePOST } from "@/app/api/projects/[projectId]/approve/route";
import { POST as leavePOST } from "@/app/api/projects/[projectId]/leave/route";
import { POST as keysPOST } from "@/app/api/keys/route";
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

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

async function createProject(agentId: string, apiKey: string, title: string, roles: Array<{ role_name: string; category: string }>) {
  const req = new NextRequest("http://localhost:3000/api/projects", {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId, title, roles }),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  });
  const res = await projectsPOST(req);
  return { res, data: await res.json() };
}

describe("POST /api/projects", () => {
  it("creates a project with roles", async () => {
    const key = await getApiKey("creator-agent");
    const { res, data } = await createProject("creator-agent", key, "Build a Website", [
      { role_name: "Frontend Dev", category: "web-development" },
      { role_name: "Designer", category: "design" },
    ]);

    expect(res.status).toBe(201);
    expect(data.project_id).toBeTruthy();
    expect(data.title).toBe("Build a Website");
    expect(data.status).toBe("open");
    expect(data.roles).toHaveLength(2);
    expect(data.roles[0].role_name).toBe("Frontend Dev");
    expect(data.roles[1].role_name).toBe("Designer");
  });

  it("rejects missing title", async () => {
    const key = await getApiKey("creator");
    const req = new NextRequest("http://localhost:3000/api/projects", {
      method: "POST",
      body: JSON.stringify({ agent_id: "creator", roles: [{ role_name: "Dev", category: "dev" }] }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    });
    const res = await projectsPOST(req);
    expect(res.status).toBe(400);
  });

  it("rejects empty roles", async () => {
    const key = await getApiKey("creator");
    const req = new NextRequest("http://localhost:3000/api/projects", {
      method: "POST",
      body: JSON.stringify({ agent_id: "creator", title: "Test", roles: [] }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    });
    const res = await projectsPOST(req);
    expect(res.status).toBe(400);
  });

  it("rejects without auth", async () => {
    const req = new NextRequest("http://localhost:3000/api/projects", {
      method: "POST",
      body: JSON.stringify({ agent_id: "creator", title: "Test", roles: [{ role_name: "Dev", category: "dev" }] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await projectsPOST(req);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/projects", () => {
  it("lists projects", async () => {
    const key = await getApiKey("creator");
    await createProject("creator", key, "Project 1", [{ role_name: "Dev", category: "dev" }]);
    await createProject("creator", key, "Project 2", [{ role_name: "Designer", category: "design" }]);

    const req = new NextRequest("http://localhost:3000/api/projects");
    const res = await projectsGET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.projects).toHaveLength(2);
    expect(data.count).toBe(2);
  });

  it("filters by status", async () => {
    const key = await getApiKey("creator");
    await createProject("creator", key, "Open Project", [{ role_name: "Dev", category: "dev" }]);

    const req = new NextRequest("http://localhost:3000/api/projects?status=open");
    const res = await projectsGET(req);
    const data = await res.json();

    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].status).toBe("open");
  });

  it("filters by category", async () => {
    const key = await getApiKey("creator");
    await createProject("creator", key, "Dev Project", [{ role_name: "Dev", category: "web-dev" }]);
    await createProject("creator", key, "Design Project", [{ role_name: "Designer", category: "design" }]);

    const req = new NextRequest("http://localhost:3000/api/projects?category=design");
    const res = await projectsGET(req);
    const data = await res.json();

    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].title).toBe("Design Project");
  });
});

describe("GET /api/projects/:projectId", () => {
  it("returns project details with roles and messages", async () => {
    const key = await getApiKey("creator");
    const { data: created } = await createProject("creator", key, "My Project", [
      { role_name: "Dev", category: "dev" },
    ]);

    const req = new NextRequest(`http://localhost:3000/api/projects/${created.project_id}`);
    const res = await projectDetailGET(req, makeParams(created.project_id));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.title).toBe("My Project");
    expect(data.roles).toHaveLength(1);
    expect(data.participants).toContain("creator");
    expect(data.messages.length).toBeGreaterThan(0); // system message from creation
  });

  it("returns 404 for unknown project", async () => {
    const req = new NextRequest("http://localhost:3000/api/projects/nonexistent");
    const res = await projectDetailGET(req, makeParams("nonexistent"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:projectId/join", () => {
  it("allows an agent to fill a role", async () => {
    const creatorKey = await getApiKey("creator");
    const joinerKey = await getApiKey("joiner");
    const { data: project } = await createProject("creator", creatorKey, "Team Project", [
      { role_name: "Backend Dev", category: "backend" },
    ]);

    const roleId = project.roles[0].id;
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: roleId }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    const res = await joinPOST(req, makeParams(project.project_id));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.role_name).toBe("Backend Dev");
    expect(data.agent_id).toBe("joiner");
    expect(data.status).toBe("negotiating");
  });

  it("rejects duplicate role filling", async () => {
    const creatorKey = await getApiKey("creator");
    const joinerKey = await getApiKey("joiner");
    const joiner2Key = await getApiKey("joiner2");
    const { data: project } = await createProject("creator", creatorKey, "Team", [
      { role_name: "Dev", category: "dev" },
    ]);

    const roleId = project.roles[0].id;

    // First join succeeds
    const req1 = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: roleId }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    await joinPOST(req1, makeParams(project.project_id));

    // Second join to same role fails
    const req2 = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner2", role_id: roleId }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joiner2Key}` },
    });
    const res2 = await joinPOST(req2, makeParams(project.project_id));
    expect(res2.status).toBe(409);
  });

  it("rejects agent joining two roles in same project", async () => {
    const creatorKey = await getApiKey("creator");
    const joinerKey = await getApiKey("joiner");
    const { data: project } = await createProject("creator", creatorKey, "Team", [
      { role_name: "Dev", category: "dev" },
      { role_name: "QA", category: "testing" },
    ]);

    // Join first role
    const req1 = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: project.roles[0].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    await joinPOST(req1, makeParams(project.project_id));

    // Try second role
    const req2 = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: project.roles[1].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    const res2 = await joinPOST(req2, makeParams(project.project_id));
    expect(res2.status).toBe(409);
  });
});

describe("POST /api/projects/:projectId/messages", () => {
  it("allows participants to send messages", async () => {
    const creatorKey = await getApiKey("creator");
    const { data: project } = await createProject("creator", creatorKey, "Chat Project", [
      { role_name: "Dev", category: "dev" },
    ]);

    const req = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "creator", content: "Hello team!" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creatorKey}` },
    });
    const res = await messagesPOST(req, makeParams(project.project_id));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message_id).toBeTruthy();
    expect(data.message_type).toBe("discussion");
  });

  it("rejects non-participants", async () => {
    const creatorKey = await getApiKey("creator");
    const outsiderKey = await getApiKey("outsider");
    const { data: project } = await createProject("creator", creatorKey, "Private", [
      { role_name: "Dev", category: "dev" },
    ]);

    const req = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "outsider", content: "Can I join?" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${outsiderKey}` },
    });
    const res = await messagesPOST(req, makeParams(project.project_id));
    expect(res.status).toBe(403);
  });

  it("allows role fillers to send messages", async () => {
    const creatorKey = await getApiKey("creator");
    const joinerKey = await getApiKey("joiner");
    const { data: project } = await createProject("creator", creatorKey, "Team", [
      { role_name: "Dev", category: "dev" },
    ]);

    // Join first
    const joinReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: project.roles[0].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    await joinPOST(joinReq, makeParams(project.project_id));

    // Then message
    const msgReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", content: "Ready to work!" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    const res = await messagesPOST(msgReq, makeParams(project.project_id));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/projects/:projectId/approve", () => {
  it("records approval from a participant", async () => {
    const creatorKey = await getApiKey("creator");
    const joinerKey = await getApiKey("joiner");
    const { data: project } = await createProject("creator", creatorKey, "Approval Test", [
      { role_name: "Dev", category: "dev" },
    ]);

    // Join
    const joinReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: project.roles[0].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    await joinPOST(joinReq, makeParams(project.project_id));

    // Creator approves
    const approveReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/approve`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "creator", approved: true }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creatorKey}` },
    });
    const res = await approvePOST(approveReq, makeParams(project.project_id));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.all_approved).toBe(false);
    expect(data.approvals).toBe(1);
    expect(data.participants).toBe(2);
  });

  it("approves project when all participants approve", async () => {
    const creatorKey = await getApiKey("creator");
    const joinerKey = await getApiKey("joiner");
    const { data: project } = await createProject("creator", creatorKey, "Full Approval", [
      { role_name: "Dev", category: "dev" },
    ]);

    // Join
    const joinReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: project.roles[0].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    await joinPOST(joinReq, makeParams(project.project_id));

    // Both approve
    const approve1 = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/approve`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "creator", approved: true }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creatorKey}` },
    });
    await approvePOST(approve1, makeParams(project.project_id));

    const approve2 = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/approve`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", approved: true }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    const res = await approvePOST(approve2, makeParams(project.project_id));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("approved");
    expect(data.all_approved).toBe(true);
  });

  it("cancels project on rejection", async () => {
    const creatorKey = await getApiKey("creator");
    const joinerKey = await getApiKey("joiner");
    const { data: project } = await createProject("creator", creatorKey, "Reject Test", [
      { role_name: "Dev", category: "dev" },
    ]);

    // Join
    const joinReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: project.roles[0].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    await joinPOST(joinReq, makeParams(project.project_id));

    // Reject
    const rejectReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/approve`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", approved: false }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    const res = await approvePOST(rejectReq, makeParams(project.project_id));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("cancelled");
  });
});

describe("POST /api/projects/:projectId/leave", () => {
  it("allows a member to leave and vacate their role", async () => {
    const creatorKey = await getApiKey("creator");
    const joinerKey = await getApiKey("joiner");
    const { data: project } = await createProject("creator", creatorKey, "Leave Test", [
      { role_name: "Dev", category: "dev" },
    ]);

    // Join
    const joinReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner", role_id: project.roles[0].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    await joinPOST(joinReq, makeParams(project.project_id));

    // Leave
    const leaveReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/leave`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "joiner" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${joinerKey}` },
    });
    const res = await leavePOST(leaveReq, makeParams(project.project_id));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.role_vacated).toBe("Dev");
    expect(data.status).toBe("open");
  });

  it("prevents creator from leaving", async () => {
    const creatorKey = await getApiKey("creator");
    const { data: project } = await createProject("creator", creatorKey, "Creator Leave", [
      { role_name: "Dev", category: "dev" },
    ]);

    const leaveReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/leave`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "creator" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creatorKey}` },
    });
    const res = await leavePOST(leaveReq, makeParams(project.project_id));
    expect(res.status).toBe(400);
  });

  it("rejects non-participants", async () => {
    const creatorKey = await getApiKey("creator");
    const outsiderKey = await getApiKey("outsider");
    const { data: project } = await createProject("creator", creatorKey, "Private", [
      { role_name: "Dev", category: "dev" },
    ]);

    const leaveReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/leave`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "outsider" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${outsiderKey}` },
    });
    const res = await leavePOST(leaveReq, makeParams(project.project_id));
    expect(res.status).toBe(400);
  });
});

describe("full project lifecycle", () => {
  it("create -> join -> message -> approve -> approved", async () => {
    const creatorKey = await getApiKey("creator");
    const dev1Key = await getApiKey("dev1");
    const dev2Key = await getApiKey("dev2");

    // Create project with 2 roles
    const { data: project } = await createProject("creator", creatorKey, "Full Stack App", [
      { role_name: "Frontend Dev", category: "frontend" },
      { role_name: "Backend Dev", category: "backend" },
    ]);
    expect(project.roles).toHaveLength(2);

    // Dev1 joins frontend
    const join1 = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "dev1", role_id: project.roles[0].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dev1Key}` },
    });
    const join1Res = await joinPOST(join1, makeParams(project.project_id));
    expect(join1Res.status).toBe(200);

    // Dev2 joins backend
    const join2 = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/join`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "dev2", role_id: project.roles[1].id }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dev2Key}` },
    });
    const join2Res = await joinPOST(join2, makeParams(project.project_id));
    const join2Data = await join2Res.json();
    expect(join2Data.all_roles_filled).toBe(true);

    // Group discussion
    const msgReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ agent_id: "creator", content: "Welcome everyone! Let's build something great." }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creatorKey}` },
    });
    await messagesPOST(msgReq, makeParams(project.project_id));

    // All three approve
    for (const [agentId, key] of [["creator", creatorKey], ["dev1", dev1Key], ["dev2", dev2Key]]) {
      const approveReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}/approve`, {
        method: "POST",
        body: JSON.stringify({ agent_id: agentId, approved: true }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      });
      await approvePOST(approveReq, makeParams(project.project_id));
    }

    // Verify final state
    const detailReq = new NextRequest(`http://localhost:3000/api/projects/${project.project_id}`);
    const detailRes = await projectDetailGET(detailReq, makeParams(project.project_id));
    const detail = await detailRes.json();

    expect(detail.status).toBe("approved");
    expect(detail.participants).toHaveLength(3);
    expect(detail.roles_filled).toBe(2);
    expect(detail.approvals).toHaveLength(3);
    expect(detail.messages.length).toBeGreaterThanOrEqual(4); // system + creation + joins + discussion
  });
});
