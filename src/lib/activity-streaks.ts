/**
 * Agent activity streaks - track daily activity and compute streak badges.
 */

export interface StreakBadge {
  id: string;
  name: string;
  description: string;
  tier: "bronze" | "silver" | "gold" | "platinum";
}

export interface StreakInfo {
  current_streak: number;
  longest_streak: number;
  total_active_days: number;
  last_active_date: string | null;
  badges: StreakBadge[];
}

export interface DailyActivity {
  date: string;
  total: number;
  types: Record<string, number>;
}

const ACTIVITY_TYPES = [
  "listing",
  "message",
  "deal",
  "proposal",
  "review",
  "login",
  "search",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export function isValidActivityType(t: string): t is ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(t);
}

/**
 * Record an activity event for an agent on a given date.
 * Uses INSERT ... ON CONFLICT to increment count if already exists.
 */
export async function recordActivity(
  db: { execute: (stmt: { sql: string; args: (string | number)[] }) => Promise<unknown> },
  agentId: string,
  activityType: ActivityType,
  date?: string,
): Promise<void> {
  const activityDate = date || new Date().toISOString().slice(0, 10);
  await db.execute({
    sql: `INSERT INTO agent_activity (agent_id, activity_date, activity_type, count)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(agent_id, activity_date, activity_type)
          DO UPDATE SET count = count + 1`,
    args: [agentId, activityDate, activityType],
  });
}

/**
 * Compute streak info from a list of distinct active dates (sorted ascending).
 */
export function computeStreaks(activeDates: string[], today: string): StreakInfo {
  if (activeDates.length === 0) {
    return {
      current_streak: 0,
      longest_streak: 0,
      total_active_days: 0,
      last_active_date: null,
      badges: [],
    };
  }

  const sorted = [...activeDates].sort();
  const lastActive = sorted[sorted.length - 1];

  // Compute current streak (must include today or yesterday to be "current")
  let currentStreak = 0;
  const todayDate = new Date(today + "T00:00:00Z");
  const lastDate = new Date(lastActive + "T00:00:00Z");
  const daysDiff = Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000);

  if (daysDiff <= 1) {
    // Active today or yesterday - count backwards
    currentStreak = 1;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const prev = new Date(sorted[i] + "T00:00:00Z");
      const curr = new Date(sorted[i + 1] + "T00:00:00Z");
      const gap = Math.floor((curr.getTime() - prev.getTime()) / 86400000);
      if (gap === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  // Compute longest streak
  let longestStreak = 1;
  let runLength = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00Z");
    const curr = new Date(sorted[i] + "T00:00:00Z");
    const gap = Math.floor((curr.getTime() - prev.getTime()) / 86400000);
    if (gap === 1) {
      runLength++;
      if (runLength > longestStreak) longestStreak = runLength;
    } else {
      runLength = 1;
    }
  }

  const badges = computeStreakBadges(currentStreak, longestStreak, sorted.length);

  return {
    current_streak: currentStreak,
    longest_streak: longestStreak,
    total_active_days: sorted.length,
    last_active_date: lastActive,
    badges,
  };
}

function computeStreakBadges(current: number, longest: number, totalDays: number): StreakBadge[] {
  const badges: StreakBadge[] = [];

  if (current >= 3)
    badges.push({
      id: "streak_3",
      name: "On Fire",
      description: "3-day activity streak",
      tier: "bronze",
    });
  if (current >= 7)
    badges.push({
      id: "streak_7",
      name: "Weekly Warrior",
      description: "7-day activity streak",
      tier: "silver",
    });
  if (current >= 14)
    badges.push({
      id: "streak_14",
      name: "Fortnight Force",
      description: "14-day activity streak",
      tier: "gold",
    });
  if (current >= 30)
    badges.push({
      id: "streak_30",
      name: "Monthly Master",
      description: "30-day activity streak",
      tier: "platinum",
    });

  if (longest >= 7 && current < 7)
    badges.push({
      id: "best_7",
      name: "Past Weekly",
      description: "Had a 7-day streak",
      tier: "bronze",
    });
  if (longest >= 30 && current < 30)
    badges.push({
      id: "best_30",
      name: "Past Monthly",
      description: "Had a 30-day streak",
      tier: "silver",
    });

  if (totalDays >= 10)
    badges.push({
      id: "active_10",
      name: "Regular",
      description: "Active for 10+ days total",
      tier: "bronze",
    });
  if (totalDays >= 30)
    badges.push({
      id: "active_30",
      name: "Dedicated",
      description: "Active for 30+ days total",
      tier: "silver",
    });
  if (totalDays >= 100)
    badges.push({
      id: "active_100",
      name: "Centurion",
      description: "Active for 100+ days total",
      tier: "gold",
    });

  return badges;
}

/**
 * Get streak info for an agent from the database.
 */
export async function getAgentStreaks(
  db: {
    execute: (stmt: {
      sql: string;
      args: (string | number)[];
    }) => Promise<{ rows: Record<string, unknown>[] }>;
  },
  agentId: string,
  today?: string,
): Promise<StreakInfo> {
  const todayStr = today || new Date().toISOString().slice(0, 10);

  const result = await db.execute({
    sql: `SELECT DISTINCT activity_date FROM agent_activity WHERE agent_id = ? ORDER BY activity_date ASC`,
    args: [agentId],
  });

  const dates = result.rows.map((r) => String(r.activity_date));
  return computeStreaks(dates, todayStr);
}

/**
 * Get daily activity breakdown for an agent over a date range.
 */
export async function getActivityHistory(
  db: {
    execute: (stmt: {
      sql: string;
      args: (string | number)[];
    }) => Promise<{ rows: Record<string, unknown>[] }>;
  },
  agentId: string,
  days: number = 30,
): Promise<DailyActivity[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const result = await db.execute({
    sql: `SELECT activity_date, activity_type, count FROM agent_activity
          WHERE agent_id = ? AND activity_date >= ?
          ORDER BY activity_date DESC`,
    args: [agentId, since],
  });

  const byDate: Record<string, DailyActivity> = {};
  for (const row of result.rows) {
    const date = String(row.activity_date);
    if (!byDate[date]) {
      byDate[date] = { date, total: 0, types: {} };
    }
    const count = Number(row.count);
    byDate[date].total += count;
    byDate[date].types[String(row.activity_type)] = count;
  }

  return Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
}
