import type { Client } from "@libsql/client";
import { fireWebhooks } from "./webhooks";

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
  | "deal_completion_requested"
  | "milestone_updated"
  | "milestone_created"
  | "project_role_filled"
  | "project_message"
  | "project_proposed"
  | "project_approved"
  | "project_started"
  | "project_completed"
  | "project_cancelled"
  | "project_member_left";

interface CreateNotification {
  agent_id: string;
  type: NotificationType;
  match_id?: string;
  from_agent_id?: string;
  summary: string;
}

/** Create a notification for an agent and fire any registered webhooks. Fire-and-forget safe. */
export async function createNotification(db: Client, notif: CreateNotification): Promise<void> {
  try {
    await db.execute({
      sql: "INSERT INTO notifications (agent_id, type, match_id, from_agent_id, summary) VALUES (?, ?, ?, ?, ?)",
      args: [notif.agent_id, notif.type, notif.match_id ?? null, notif.from_agent_id ?? null, notif.summary],
    });

    // Also fire webhooks (non-blocking)
    fireWebhooks(db, notif.agent_id, notif.type, notif.match_id, notif.from_agent_id, notif.summary);
  } catch {
    // Notification failures should never break the main operation
  }
}
