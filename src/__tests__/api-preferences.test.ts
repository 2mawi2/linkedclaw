import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET, PUT } from "@/app/api/preferences/route";
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

function jsonReq(
  url: string,
  opts?: { body?: unknown; apiKey?: string; method?: string },
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts?.body) headers["Content-Type"] = "application/json";
  if (opts?.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
  const method = opts?.method ?? (opts?.body ? "PUT" : "GET");
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
    headers,
  });
}

describe("Agent Preferences API", () => {
  it("requires authentication for GET", async () => {
    const res = await GET(jsonReq("/api/preferences"));
    expect(res.status).toBe(401);
  });

  it("requires authentication for PUT", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", { body: { timezone: "UTC" } }),
    );
    expect(res.status).toBe(401);
  });

  it("returns defaults when no preferences set", async () => {
    const res = await GET(jsonReq("/api/preferences", { apiKey: aliceKey }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.timezone).toBe("UTC");
    expect(data.notifications.new_matches).toBe(true);
    expect(data.notifications.messages).toBe(true);
    expect(data.notifications.deal_updates).toBe(true);
    expect(data.notifications.listing_expiry).toBe(true);
    expect(data.notifications.digest).toBe(true);
    expect(data.auto_accept.enabled).toBe(false);
    expect(data.auto_accept.max_rate).toBeNull();
    expect(data.auto_accept.categories).toBeNull();
  });

  it("sets timezone", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", {
        body: { timezone: "America/New_York" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.timezone).toBe("America/New_York");
  });

  it("rejects invalid timezone", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", {
        body: { timezone: "invalid" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts UTC timezone", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", {
        body: { timezone: "UTC" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.timezone).toBe("UTC");
  });

  it("updates notification preferences", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", {
        body: {
          notifications: {
            new_matches: false,
            messages: true,
            digest: false,
          },
        },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notifications.new_matches).toBe(false);
    expect(data.notifications.messages).toBe(true);
    expect(data.notifications.digest).toBe(false);
    // Defaults preserved for unset fields
    expect(data.notifications.deal_updates).toBe(true);
    expect(data.notifications.listing_expiry).toBe(true);
  });

  it("sets auto-accept rules", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", {
        body: {
          auto_accept: {
            enabled: true,
            max_rate: 150,
            categories: ["development", "design"],
          },
        },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.auto_accept.enabled).toBe(true);
    expect(data.auto_accept.max_rate).toBe(150);
    expect(data.auto_accept.categories).toEqual(["development", "design"]);
  });

  it("rejects negative max_rate", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", {
        body: { auto_accept: { max_rate: -10 } },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid categories type", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", {
        body: { auto_accept: { categories: "not-an-array" } },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("updates existing preferences without overwriting others", async () => {
    // First set timezone
    await PUT(
      jsonReq("/api/preferences", {
        body: { timezone: "Europe/Berlin" },
        apiKey: aliceKey,
      }),
    );

    // Then update notifications only
    await PUT(
      jsonReq("/api/preferences", {
        body: { notifications: { new_matches: false } },
        apiKey: aliceKey,
      }),
    );

    // Verify both are preserved
    const res = await GET(jsonReq("/api/preferences", { apiKey: aliceKey }));
    const data = await res.json();
    expect(data.timezone).toBe("Europe/Berlin");
    expect(data.notifications.new_matches).toBe(false);
  });

  it("isolates preferences between agents", async () => {
    await PUT(
      jsonReq("/api/preferences", {
        body: { timezone: "Asia/Tokyo" },
        apiKey: aliceKey,
      }),
    );

    const bobRes = await GET(jsonReq("/api/preferences", { apiKey: bobKey }));
    const bobData = await bobRes.json();
    expect(bobData.timezone).toBe("UTC"); // Bob gets defaults
  });

  it("handles all fields at once", async () => {
    const res = await PUT(
      jsonReq("/api/preferences", {
        body: {
          timezone: "Europe/London",
          notifications: {
            new_matches: false,
            messages: false,
            deal_updates: false,
            listing_expiry: false,
            digest: false,
          },
          auto_accept: {
            enabled: true,
            max_rate: 200,
            categories: ["consulting"],
          },
        },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.timezone).toBe("Europe/London");
    expect(data.notifications.new_matches).toBe(false);
    expect(data.notifications.messages).toBe(false);
    expect(data.auto_accept.enabled).toBe(true);
    expect(data.auto_accept.max_rate).toBe(200);
    expect(data.auto_accept.categories).toEqual(["consulting"]);
    expect(data.updated_at).toBeDefined();
  });
});
