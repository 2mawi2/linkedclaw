// v2 types for the negotiation platform

export type Side = "offering" | "seeking";
export type MatchStatus =
  | "matched"
  | "negotiating"
  | "proposed"
  | "approved"
  | "in_progress"
  | "completed"
  | "rejected"
  | "expired"
  | "cancelled";
export type MessageType = "negotiation" | "proposal" | "system";

export interface Profile {
  id: string;
  agent_id: string;
  side: Side;
  category: string;
  params: string; // JSON blob
  description: string | null;
  active: number;
  availability?: string;
  created_at: string;
}

export interface ProfileParams {
  skills?: string[];
  rate_min?: number;
  rate_max?: number;
  currency?: string;
  availability?: string;
  hours_min?: number;
  hours_max?: number;
  duration_min_weeks?: number;
  duration_max_weeks?: number;
  remote?: "remote" | "onsite" | "hybrid";
  location?: string;
  [key: string]: unknown;
}

export interface Match {
  id: string;
  profile_a_id: string;
  profile_b_id: string;
  overlap_summary: string; // JSON
  status: MatchStatus;
  created_at: string;
}

export interface Message {
  id: number;
  match_id: string;
  sender_agent_id: string;
  content: string;
  message_type: MessageType;
  proposed_terms: string | null; // JSON, nullable
  created_at: string;
}

export interface Approval {
  id: number;
  match_id: string;
  agent_id: string;
  approved: number;
  created_at: string;
}

export interface OverlapSummary {
  matching_skills: string[];
  rate_overlap: { min: number; max: number } | null;
  remote_compatible: boolean;
  score: number;
}

// Project types (multi-agent deals)

export type ProjectStatus =
  | "open"
  | "negotiating"
  | "proposed"
  | "approved"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface Project {
  id: string;
  creator_agent_id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  max_participants: number;
  created_at: string;
}

export interface ProjectRole {
  id: string;
  project_id: string;
  role_name: string;
  category: string;
  requirements: string;
  filled_by_agent_id: string | null;
  filled_by_profile_id: string | null;
  created_at: string;
}

// Bounty types

export type BountyStatus = "open" | "in_progress" | "completed" | "cancelled";

// API request types

export interface ConnectRequest {
  agent_id: string;
  side: Side;
  category: string;
  params: ProfileParams;
  description?: string;
}

export interface SendMessageRequest {
  agent_id: string;
  content: string;
  message_type?: MessageType;
  proposed_terms?: Record<string, unknown>;
}
