/**
 * Pagination helpers for API list endpoints.
 *
 * Adds standard HTTP pagination headers:
 *  - X-Total-Count: total number of items
 *  - Link: RFC 8288 link relations (first, prev, next, last)
 */

import { NextResponse } from "next/server";

interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  /** Base URL for Link header (without query params). Falls back to empty rel links. */
  baseUrl?: string;
}

/**
 * Build RFC 8288 Link header value from pagination state.
 */
function buildLinkHeader(meta: PaginationMeta): string | null {
  if (!meta.baseUrl) return null;

  const { total, limit, offset, baseUrl } = meta;
  const lastOffset = Math.max(0, Math.floor((total - 1) / limit) * limit);
  const links: string[] = [];

  // first
  links.push(`<${baseUrl}?limit=${limit}&offset=0>; rel="first"`);

  // prev (only if not on first page)
  if (offset > 0) {
    const prevOffset = Math.max(0, offset - limit);
    links.push(`<${baseUrl}?limit=${limit}&offset=${prevOffset}>; rel="prev"`);
  }

  // next (only if more items exist)
  if (offset + limit < total) {
    const nextOffset = offset + limit;
    links.push(`<${baseUrl}?limit=${limit}&offset=${nextOffset}>; rel="next"`);
  }

  // last
  links.push(`<${baseUrl}?limit=${limit}&offset=${lastOffset}>; rel="last"`);

  return links.join(", ");
}

/**
 * Create a NextResponse.json with pagination headers attached.
 */
export function jsonWithPagination<T>(body: T, meta: PaginationMeta, status = 200): NextResponse {
  const headers: Record<string, string> = {
    "X-Total-Count": String(meta.total),
  };

  const link = buildLinkHeader(meta);
  if (link) {
    headers["Link"] = link;
  }

  return NextResponse.json(body, { status, headers });
}

/**
 * Extract the base URL (origin + pathname) from a Request for Link headers.
 */
export function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.origin}${url.pathname}`;
}
