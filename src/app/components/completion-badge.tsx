"use client";

/**
 * Visual deal completion rate badge.
 * Shows a circular progress ring with percentage and tier color.
 */

interface CompletionBadgeProps {
  rate: number; // 0-100
  tier: "none" | "bronze" | "silver" | "gold" | "platinum";
  label: string;
  eligible: boolean;
  size?: "sm" | "md" | "lg";
}

const TIER_COLORS: Record<string, { stroke: string; text: string; bg: string }> = {
  platinum: {
    stroke: "stroke-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
  },
  gold: {
    stroke: "stroke-yellow-500",
    text: "text-yellow-600 dark:text-yellow-400",
    bg: "bg-yellow-50 dark:bg-yellow-900/20",
  },
  silver: {
    stroke: "stroke-gray-400",
    text: "text-gray-600 dark:text-gray-300",
    bg: "bg-gray-50 dark:bg-gray-800/50",
  },
  bronze: {
    stroke: "stroke-orange-500",
    text: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-900/20",
  },
  none: {
    stroke: "stroke-gray-300 dark:stroke-gray-600",
    text: "text-gray-400 dark:text-gray-500",
    bg: "bg-gray-50 dark:bg-gray-800/50",
  },
};

const SIZES = {
  sm: { svg: 40, radius: 16, strokeWidth: 3, fontSize: "text-xs" },
  md: { svg: 56, radius: 22, strokeWidth: 4, fontSize: "text-sm" },
  lg: { svg: 72, radius: 28, strokeWidth: 5, fontSize: "text-base" },
};

export function CompletionBadge({
  rate,
  tier,
  label,
  eligible,
  size = "md",
}: CompletionBadgeProps) {
  const colors = TIER_COLORS[tier] || TIER_COLORS.none;
  const dims = SIZES[size];
  const circumference = 2 * Math.PI * dims.radius;
  const progress = eligible ? (rate / 100) * circumference : 0;
  const dashOffset = circumference - progress;

  return (
    <div className="flex items-center gap-2" title={`${label} - ${rate}% completion rate`}>
      <div className="relative flex-shrink-0">
        <svg width={dims.svg} height={dims.svg} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={dims.svg / 2}
            cy={dims.svg / 2}
            r={dims.radius}
            fill="none"
            strokeWidth={dims.strokeWidth}
            className="stroke-gray-200 dark:stroke-gray-700"
          />
          {/* Progress circle */}
          {eligible && (
            <circle
              cx={dims.svg / 2}
              cy={dims.svg / 2}
              r={dims.radius}
              fill="none"
              strokeWidth={dims.strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className={colors.stroke}
            />
          )}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold ${dims.fontSize} ${colors.text}`}>
            {eligible ? `${rate}%` : "---"}
          </span>
        </div>
      </div>
      {size !== "sm" && (
        <div className="min-w-0">
          <p className={`text-xs font-medium ${colors.text}`}>{label}</p>
          <p className="text-xs text-gray-400">Completion rate</p>
        </div>
      )}
    </div>
  );
}

/**
 * Inline badge for listing cards - just the tier icon + rate.
 */
export function CompletionBadgeInline({
  rate,
  tier,
  eligible,
}: {
  rate: number;
  tier: string;
  eligible: boolean;
}) {
  if (!eligible) return null;

  const tierIcons: Record<string, string> = {
    platinum: "💎",
    gold: "🥇",
    silver: "🥈",
    bronze: "🥉",
  };

  const icon = tierIcons[tier] || "";
  const colors = TIER_COLORS[tier] || TIER_COLORS.none;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}
      title={`${rate}% deal completion rate`}
    >
      {icon && <span className="text-[10px]">{icon}</span>}
      {rate}%
    </span>
  );
}
