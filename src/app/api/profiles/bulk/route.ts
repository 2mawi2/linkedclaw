import { NextRequest, NextResponse } from "next/server";
import { ensureDb, validateTags, saveTags } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Profile, ProfileParams } from "@/lib/types";

type BulkAction = "update" | "deactivate" | "activate";

interface BulkOperation {
  profile_id: string;
  action: BulkAction;
  /** For update action: fields to update */
  params?: Record<string, unknown>;
  description?: string | null;
  availability?: string;
  tags?: string[];
}

interface BulkResult {
  profile_id: string;
  action: BulkAction;
  success: boolean;
  error?: string;
}

const VALID_ACTIONS: BulkAction[] = ["update", "deactivate", "activate"];
const MAX_OPERATIONS = 50;

function validateOperations(
  body: unknown,
): { valid: true; operations: BulkOperation[] } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body" };
  }

  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.operations)) {
    return { valid: false, error: "operations must be an array" };
  }

  if (b.operations.length === 0) {
    return { valid: false, error: "operations array must not be empty" };
  }

  if (b.operations.length > MAX_OPERATIONS) {
    return { valid: false, error: `Maximum ${MAX_OPERATIONS} operations per request` };
  }

  const operations: BulkOperation[] = [];

  for (let i = 0; i < b.operations.length; i++) {
    const op = b.operations[i] as Record<string, unknown>;

    if (!op || typeof op !== "object") {
      return { valid: false, error: `operations[${i}] must be an object` };
    }

    if (!op.profile_id || typeof op.profile_id !== "string") {
      return { valid: false, error: `operations[${i}].profile_id is required` };
    }

    if (!op.action || !VALID_ACTIONS.includes(op.action as BulkAction)) {
      return {
        valid: false,
        error: `operations[${i}].action must be one of: ${VALID_ACTIONS.join(", ")}`,
      };
    }

    if (op.action === "update") {
      if (!op.params && op.description === undefined && !op.availability && !op.tags) {
        return {
          valid: false,
          error: `operations[${i}]: update action requires at least one of params, description, availability, or tags`,
        };
      }

      if (op.availability !== undefined) {
        if (!["available", "busy", "away"].includes(op.availability as string)) {
          return {
            valid: false,
            error: `operations[${i}].availability must be 'available', 'busy', or 'away'`,
          };
        }
      }

      if (op.tags !== undefined) {
        const tagValidation = validateTags(op.tags);
        if (!tagValidation.valid) {
          return { valid: false, error: `operations[${i}].tags: ${tagValidation.error}` };
        }
      }
    }

    operations.push({
      profile_id: op.profile_id as string,
      action: op.action as BulkAction,
      params: op.params as Record<string, unknown> | undefined,
      description: op.description as string | null | undefined,
      availability: op.availability as string | undefined,
      tags: op.tags as string[] | undefined,
    });
  }

  return { valid: true, operations };
}

/**
 * POST /api/profiles/bulk - Bulk update/deactivate/activate listings
 *
 * Body: { operations: [{ profile_id, action, params?, description?, availability?, tags? }] }
 * Actions: "update" | "deactivate" | "activate"
 * Max 50 operations per request.
 */
export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateOperations(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { operations } = validation;
  const db = await ensureDb();
  const results: BulkResult[] = [];

  // Fetch all profiles in one query to verify ownership
  const profileIds = [...new Set(operations.map((op) => op.profile_id))];
  const placeholders = profileIds.map(() => "?").join(", ");
  const profilesResult = await db.execute({
    sql: `SELECT id, agent_id, params, active FROM profiles WHERE id IN (${placeholders})`,
    args: profileIds,
  });

  const profileMap = new Map<string, { agent_id: string; params: string; active: number }>();
  for (const row of profilesResult.rows) {
    const r = row as unknown as { id: string; agent_id: string; params: string; active: number };
    profileMap.set(r.id, r);
  }

  for (const op of operations) {
    const profile = profileMap.get(op.profile_id);

    if (!profile) {
      results.push({
        profile_id: op.profile_id,
        action: op.action,
        success: false,
        error: "Profile not found",
      });
      continue;
    }

    if (profile.agent_id !== auth.agent_id) {
      results.push({
        profile_id: op.profile_id,
        action: op.action,
        success: false,
        error: "Not authorized",
      });
      continue;
    }

    try {
      if (op.action === "deactivate") {
        if (!profile.active) {
          results.push({
            profile_id: op.profile_id,
            action: op.action,
            success: false,
            error: "Already inactive",
          });
          continue;
        }
        await db.execute({
          sql: "UPDATE profiles SET active = 0 WHERE id = ?",
          args: [op.profile_id],
        });
        results.push({ profile_id: op.profile_id, action: op.action, success: true });
      } else if (op.action === "activate") {
        if (profile.active) {
          results.push({
            profile_id: op.profile_id,
            action: op.action,
            success: false,
            error: "Already active",
          });
          continue;
        }
        await db.execute({
          sql: "UPDATE profiles SET active = 1 WHERE id = ?",
          args: [op.profile_id],
        });
        results.push({ profile_id: op.profile_id, action: op.action, success: true });
      } else if (op.action === "update") {
        if (!profile.active) {
          results.push({
            profile_id: op.profile_id,
            action: op.action,
            success: false,
            error: "Cannot update inactive profile",
          });
          continue;
        }

        const updates: string[] = [];
        const values: (string | null)[] = [];

        if (op.params && typeof op.params === "object") {
          const existingParams: ProfileParams = JSON.parse(profile.params);
          const merged = { ...existingParams, ...op.params };
          updates.push("params = ?");
          values.push(JSON.stringify(merged));
        }

        if (op.description !== undefined) {
          updates.push("description = ?");
          values.push(op.description as string | null);
        }

        if (op.availability !== undefined) {
          updates.push("availability = ?");
          values.push(op.availability);
        }

        if (updates.length > 0) {
          values.push(op.profile_id);
          await db.execute({
            sql: `UPDATE profiles SET ${updates.join(", ")} WHERE id = ?`,
            args: values,
          });
        }

        if (op.tags !== undefined) {
          const tagValidation = validateTags(op.tags);
          if (tagValidation.valid && tagValidation.tags) {
            await saveTags(db, op.profile_id, tagValidation.tags);
          }
        }

        results.push({ profile_id: op.profile_id, action: op.action, success: true });
      }
    } catch (err) {
      results.push({
        profile_id: op.profile_id,
        action: op.action,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({
    total: results.length,
    succeeded,
    failed,
    results,
  });
}
