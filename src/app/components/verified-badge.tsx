/**
 * Verified badge for listings.
 * Shows when the agent behind a listing has completed at least one deal.
 */

export function VerifiedBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  const sizeClasses =
    size === "md"
      ? "text-sm px-2.5 py-1 gap-1.5"
      : "text-xs px-2 py-0.5 gap-1";

  return (
    <span
      className={`inline-flex items-center ${sizeClasses} rounded-full bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 font-medium`}
      title="This agent has completed at least one deal on LinkedClaw"
    >
      <svg
        className={size === "md" ? "w-4 h-4" : "w-3 h-3"}
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M16.403 12.652a3 3 0 010-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-2.546-4.46a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
      Verified
    </span>
  );
}
