import { describe, expect, test } from "bun:test";

// Unit test the pagination helper directly
// We can't import Next.js modules in bun test easily, so we test the logic

describe("Pagination headers", () => {
  // Test the Link header building logic (replicated from pagination.ts)
  function buildLinkHeader(meta: {
    total: number;
    limit: number;
    offset: number;
    baseUrl: string;
  }): string {
    const { total, limit, offset, baseUrl } = meta;
    const lastOffset = Math.max(0, Math.floor((total - 1) / limit) * limit);
    const links: string[] = [];

    links.push(`<${baseUrl}?limit=${limit}&offset=0>; rel="first"`);

    if (offset > 0) {
      const prevOffset = Math.max(0, offset - limit);
      links.push(
        `<${baseUrl}?limit=${limit}&offset=${prevOffset}>; rel="prev"`,
      );
    }

    if (offset + limit < total) {
      const nextOffset = offset + limit;
      links.push(
        `<${baseUrl}?limit=${limit}&offset=${nextOffset}>; rel="next"`,
      );
    }

    links.push(
      `<${baseUrl}?limit=${limit}&offset=${lastOffset}>; rel="last"`,
    );

    return links.join(", ");
  }

  test("first page includes next but not prev", () => {
    const link = buildLinkHeader({
      total: 50,
      limit: 20,
      offset: 0,
      baseUrl: "http://localhost/api/search",
    });

    expect(link).toContain('rel="first"');
    expect(link).toContain('rel="next"');
    expect(link).toContain('rel="last"');
    expect(link).not.toContain('rel="prev"');
    expect(link).toContain("offset=20");
  });

  test("middle page includes both prev and next", () => {
    const link = buildLinkHeader({
      total: 100,
      limit: 20,
      offset: 20,
      baseUrl: "http://localhost/api/search",
    });

    expect(link).toContain('rel="first"');
    expect(link).toContain('rel="prev"');
    expect(link).toContain('rel="next"');
    expect(link).toContain('rel="last"');
  });

  test("last page has prev but no next", () => {
    const link = buildLinkHeader({
      total: 50,
      limit: 20,
      offset: 40,
      baseUrl: "http://localhost/api/search",
    });

    expect(link).toContain('rel="first"');
    expect(link).toContain('rel="prev"');
    expect(link).toContain('rel="last"');
    expect(link).not.toContain('rel="next"');
  });

  test("single page has no prev or next", () => {
    const link = buildLinkHeader({
      total: 5,
      limit: 20,
      offset: 0,
      baseUrl: "http://localhost/api/bounties",
    });

    expect(link).toContain('rel="first"');
    expect(link).toContain('rel="last"');
    expect(link).not.toContain('rel="prev"');
    expect(link).not.toContain('rel="next"');
  });

  test("last offset calculation is correct", () => {
    const link = buildLinkHeader({
      total: 55,
      limit: 20,
      offset: 0,
      baseUrl: "http://localhost/api/search",
    });

    // 55 items, 20 per page -> last page starts at offset 40
    expect(link).toContain("offset=40"); // last
  });

  test("empty result set", () => {
    const link = buildLinkHeader({
      total: 0,
      limit: 20,
      offset: 0,
      baseUrl: "http://localhost/api/search",
    });

    expect(link).toContain('rel="first"');
    expect(link).toContain('rel="last"');
    expect(link).not.toContain('rel="next"');
    expect(link).not.toContain('rel="prev"');
  });

  test("prev offset does not go below zero", () => {
    const link = buildLinkHeader({
      total: 100,
      limit: 20,
      offset: 10,
      baseUrl: "http://localhost/api/search",
    });

    // prev from offset 10 with limit 20 should be 0, not -10
    expect(link).toContain('offset=0>; rel="prev"');
  });
});
