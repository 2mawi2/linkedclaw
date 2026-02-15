import { generateApiKey } from "@/lib/auth";
import { ensureDb } from "@/lib/db";

/**
 * Create an API key for an agent directly in the database.
 * Use this instead of calling the /api/keys endpoint (which requires auth).
 */
export async function createApiKey(agentId: string): Promise<string> {
  const { raw, hash } = generateApiKey();
  const id = crypto.randomUUID();
  const db = await ensureDb();
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, key_hash) VALUES (?, ?, ?)",
    args: [id, agentId, hash],
  });
  return raw;
}
