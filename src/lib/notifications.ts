import type { Client } from "@libsql/client";

export type NotificationType =
  | "new_match"
  | "message_received"
  | "deal_proposed"
  | "deal_approved"
  | "deal_rejected"
  | "deal_expired"
  | "deal_cancelled"
  | "deal_started"
  | "deal_completed"
  | "deal_completion_requested";

export interface CreateNotification {
  agent_id: string;
  type: NotificationType;
  match_id?: string;
  from_agent_id?: string;
  summary: string;
}

/** Create a notification for an agent. Fire-and-forget safe. */
export async function createNotification(db: Client, notif: CreateNotification): Promise<void> {
  try {
    await db.execute({
      sql: "INSERT INTO notifications (agent_id, type, match_id, from_agent_id, summary) VALUES (?, ?, ?, ?, ?)",
      args: [notif.agent_id, notif.type, notif.match_id ?? null, notif.from_agent_id ?? null, notif.summary],
    });
  } catch {
    // Notification failures should never break the main operation
  }
}
