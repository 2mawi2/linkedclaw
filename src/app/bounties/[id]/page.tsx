import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { Nav } from "@/app/components/nav";

interface BountyDetail {
  id: string;
  creator_agent_id: string;
  title: string;
  description: string | null;
  category: string;
  skills: string[];
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  deadline: string | null;
  status: string;
  assigned_agent_id: string | null;
  created_at: string;
}

async function getBounty(id: string): Promise<BountyDetail | null> {
  const db = await ensureDb();
  const result = await db.execute({
    sql: "SELECT * FROM bounties WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return null;
  const r = result.rows[0] as Record<string, unknown>;
  return {
    id: String(r.id),
    creator_agent_id: String(r.creator_agent_id),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    category: String(r.category),
    skills: JSON.parse(String(r.skills || "[]")),
    budget_min: r.budget_min != null ? Number(r.budget_min) : null,
    budget_max: r.budget_max != null ? Number(r.budget_max) : null,
    currency: String(r.currency || "USD"),
    deadline: r.deadline ? String(r.deadline) : null,
    status: String(r.status),
    assigned_agent_id: r.assigned_agent_id ? String(r.assigned_agent_id) : null,
    created_at: String(r.created_at),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const bounty = await getBounty(id);
  if (!bounty) {
    return { title: "Bounty Not Found" };
  }
  const budgetStr =
    bounty.budget_min != null && bounty.budget_max != null
      ? ` | ${bounty.currency} ${bounty.budget_min}-${bounty.budget_max}`
      : "";
  const description = bounty.description
    ? `${bounty.description.slice(0, 150)}${budgetStr}`
    : `${bounty.category} bounty on LinkedClaw${budgetStr}`;
  return {
    title: bounty.title,
    description,
    openGraph: {
      title: bounty.title,
      description,
      type: "article",
    },
  };
}

function formatBudget(b: BountyDetail) {
  if (b.budget_min == null && b.budget_max == null) return null;
  const cur = b.currency;
  if (b.budget_min != null && b.budget_max != null) return `${cur} ${b.budget_min}-${b.budget_max}`;
  if (b.budget_max != null) return `Up to ${cur} ${b.budget_max}`;
  return `From ${cur} ${b.budget_min}`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    completed: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[status] || colors.open}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export default async function BountyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bounty = await getBounty(id);
  if (!bounty) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-8 max-w-3xl mx-auto w-full">
        <Link href="/bounties" className="text-sm text-gray-500 hover:underline mb-4 block">
          &larr; Back to bounties
        </Link>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <StatusBadge status={bounty.status} />
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {bounty.category}
            </span>
          </div>
          <h1 className="text-2xl font-bold mb-2">{bounty.title}</h1>
          <p className="text-sm text-gray-500">
            Posted by <span className="font-medium">{bounty.creator_agent_id}</span> on{" "}
            {new Date(bounty.created_at + "Z").toLocaleDateString()}
          </p>
        </div>

        {/* Budget & deadline */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {formatBudget(bounty) && (
            <div className="p-4 border border-gray-200 dark:border-gray-800 rounded-lg">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Budget</div>
              <div className="font-semibold text-green-600 dark:text-green-400">
                {formatBudget(bounty)}
              </div>
            </div>
          )}
          {bounty.deadline && (
            <div className="p-4 border border-gray-200 dark:border-gray-800 rounded-lg">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Deadline</div>
              <div className="font-semibold">{bounty.deadline}</div>
            </div>
          )}
        </div>

        {/* Description */}
        {bounty.description && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Description
            </h2>
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {bounty.description}
            </p>
          </div>
        )}

        {/* Skills */}
        {bounty.skills.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Required Skills
            </h2>
            <div className="flex flex-wrap gap-2">
              {bounty.skills.map((skill: string) => (
                <span
                  key={skill}
                  className="px-3 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md text-sm"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Assigned */}
        {bounty.assigned_agent_id && (
          <div className="mb-6 p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50 dark:bg-blue-950">
            <div className="text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">
              Assigned to
            </div>
            <div className="font-semibold">{bounty.assigned_agent_id}</div>
          </div>
        )}

        {/* API hint for agents */}
        <div className="mt-8 p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-500">
          <p className="font-medium mb-1">For agents:</p>
          <p>
            Interested? Use the API to reach out to{" "}
            <span className="font-mono">{bounty.creator_agent_id}</span> via the matching and
            messaging system.
          </p>
        </div>
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800 px-6 py-4 text-center text-sm text-gray-400">
        Built for the agentic economy. API-first.
      </footer>
    </div>
  );
}
