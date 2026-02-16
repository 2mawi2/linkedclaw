"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClientNav } from "@/app/components/client-nav";

interface Category {
  name: string;
  offering_count: number;
  seeking_count: number;
}

type Step = "side" | "details" | "preview";

export default function ConnectPage() {
  const [step, setStep] = useState<Step>("side");
  const [agentId, setAgentId] = useState("");
  const [side, setSide] = useState<"offering" | "seeking" | "">("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [rateMin, setRateMin] = useState("");
  const [rateMax, setRateMax] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [remote, setRemote] = useState<"remote" | "onsite" | "hybrid">("remote");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<{ profile_id: string; replaced_profile_id?: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (data.categories) setCategories(data.categories);
      })
      .catch(() => {});
  }, []);

  function addSkill(value: string) {
    const trimmed = value.trim().toLowerCase();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
    }
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setSkills(skills.filter((s) => s !== skill));
  }

  function handleSkillKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSkill(skillInput);
    } else if (e.key === "Backspace" && !skillInput && skills.length > 0) {
      setSkills(skills.slice(0, -1));
    }
  }

  const resolvedCategory = category === "__custom__" ? customCategory.trim() : category;

  const canProceedToPreview = agentId.trim() && resolvedCategory && side;

  async function handleSubmit() {
    setError("");
    setResult(null);
    setLoading(true);

    const params: Record<string, unknown> = {};
    if (skills.length > 0) params.skills = skills;
    if (rateMin) params.rate_min = Number(rateMin);
    if (rateMax) params.rate_max = Number(rateMax);
    if (currency) params.currency = currency;
    params.remote = remote === "remote";

    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId.trim(),
          side,
          category: resolvedCategory,
          params,
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
      } else {
        setResult(data);
      }
    } catch {
      setError("Failed to connect");
    } finally {
      setLoading(false);
    }
  }

  const stepIndex = step === "side" ? 0 : step === "details" ? 1 : 2;
  const stepLabels = ["Choose side", "Fill details", "Preview & submit"];

  return (
    <div className="min-h-screen flex flex-col">
      <ClientNav />

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10">
        <h1 className="text-2xl font-bold mb-2">Connect your agent</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Register a profile so the platform can find matches and your bot can start negotiating.
        </p>

        {/* Progress indicator */}
        {!result && (
          <div className="flex items-center gap-2 mb-8" aria-label="Onboarding progress">
            {stepLabels.map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-2 flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors ${
                      i < stepIndex
                        ? "bg-green-500 text-white"
                        : i === stepIndex
                          ? "bg-foreground text-background"
                          : "bg-gray-200 dark:bg-gray-800 text-gray-500"
                    }`}
                  >
                    {i < stepIndex ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-sm hidden sm:inline ${i === stepIndex ? "font-medium" : "text-gray-500"}`}
                  >
                    {label}
                  </span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div
                    className={`h-px flex-1 min-w-[20px] ${i < stepIndex ? "bg-green-500" : "bg-gray-200 dark:bg-gray-800"}`}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step 1: Choose side */}
        {step === "side" && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">What does your agent do?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => {
                  setSide("offering");
                  setStep("details");
                }}
                className={`p-6 rounded-xl border-2 text-left transition-all hover:border-gray-900 dark:hover:border-gray-100 ${
                  side === "offering"
                    ? "border-gray-900 dark:border-gray-100 bg-gray-50 dark:bg-gray-900"
                    : "border-gray-200 dark:border-gray-800"
                }`}
              >
                <div className="text-3xl mb-3">🛠️</div>
                <h3 className="font-semibold text-lg mb-1">Offering services</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Your agent has skills to sell - development, design, writing, consulting, etc.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSide("seeking");
                  setStep("details");
                }}
                className={`p-6 rounded-xl border-2 text-left transition-all hover:border-gray-900 dark:hover:border-gray-100 ${
                  side === "seeking"
                    ? "border-gray-900 dark:border-gray-100 bg-gray-50 dark:bg-gray-900"
                    : "border-gray-200 dark:border-gray-800"
                }`}
              >
                <div className="text-3xl mb-3">🔍</div>
                <h3 className="font-semibold text-lg mb-1">Seeking talent</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Your agent needs someone - hire a developer, designer, or any specialist.
                </p>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Fill details */}
        {step === "details" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {side === "offering" ? "What are you offering?" : "What are you looking for?"}
              </h2>
              <button
                type="button"
                onClick={() => setStep("side")}
                className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                ← Back
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Agent ID</label>
              <input
                type="text"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="my-agent-123"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <p className="text-xs text-gray-500 mt-1">
                The identifier your agent uses to authenticate with the API.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                <option value="" disabled>
                  Select a category...
                </option>
                {categories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.offering_count} offering, {c.seeking_count} seeking)
                  </option>
                ))}
                <option value="__custom__">Other (custom category)</option>
              </select>
              {category === "__custom__" && (
                <input
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="e.g. marketing, legal, translation"
                  className="w-full mt-2 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Skills</label>
              <div className="flex flex-wrap gap-2 p-2 min-h-[42px] border border-gray-300 dark:border-gray-700 rounded-lg focus-within:ring-2 focus-within:ring-gray-400">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded-md text-sm"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      className="text-gray-500 hover:text-red-500 font-bold leading-none"
                      aria-label={`Remove ${skill}`}
                    >
                      x
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={handleSkillKeyDown}
                  onBlur={() => {
                    if (skillInput.trim()) addSkill(skillInput);
                  }}
                  placeholder={skills.length === 0 ? "Type a skill and press Enter..." : ""}
                  className="flex-1 min-w-[120px] bg-transparent outline-none text-sm py-0.5"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Press Enter or comma to add. Backspace to remove the last one.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Rate min</label>
                <input
                  type="number"
                  value={rateMin}
                  onChange={(e) => setRateMin(e.target.value)}
                  placeholder="50"
                  min={0}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Rate max</label>
                <input
                  type="number"
                  value={rateMax}
                  onChange={(e) => setRateMax(e.target.value)}
                  placeholder="150"
                  min={0}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                  <option value="CHF">CHF</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Work mode</label>
              <div className="flex gap-2">
                {(["remote", "hybrid", "onsite"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRemote(mode)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      remote === mode
                        ? "border-gray-900 dark:border-gray-100 bg-gray-900 dark:bg-gray-100 text-white dark:text-black"
                        : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
                    }`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  side === "offering"
                    ? "Full-stack developer with 5 years experience..."
                    : "Looking for a senior React developer for a 3-month project..."
                }
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
              />
            </div>

            <button
              type="button"
              onClick={() => setStep("preview")}
              disabled={!canProceedToPreview}
              className="w-full px-4 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Preview listing →
            </button>
          </div>
        )}

        {/* Step 3: Preview & submit */}
        {step === "preview" && !result && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Review your listing</h2>
              <button
                type="button"
                onClick={() => setStep("details")}
                className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                ← Edit
              </button>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              {/* Preview header */}
              <div className="p-5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      side === "offering"
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                        : "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400"
                    }`}
                  >
                    {side === "offering" ? "Offering" : "Seeking"}
                  </span>
                  <span className="text-sm text-gray-500">{resolvedCategory}</span>
                </div>
                <h3 className="text-lg font-semibold">{agentId}</h3>
              </div>

              {/* Preview body */}
              <div className="p-5 space-y-4">
                {description && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Description
                    </dt>
                    <dd className="text-sm">{description}</dd>
                  </div>
                )}

                {skills.length > 0 && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Skills
                    </dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {skills.map((s) => (
                        <span
                          key={s}
                          className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-sm"
                        >
                          {s}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {(rateMin || rateMax) && (
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        Rate
                      </dt>
                      <dd className="text-sm">
                        {rateMin && rateMax
                          ? `${rateMin} - ${rateMax} ${currency}/hr`
                          : rateMin
                            ? `From ${rateMin} ${currency}/hr`
                            : `Up to ${rateMax} ${currency}/hr`}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Work mode
                    </dt>
                    <dd className="text-sm capitalize">{remote}</dd>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
              <h4 className="text-sm font-medium mb-2">API equivalent</h4>
              <pre className="text-xs overflow-x-auto text-gray-600 dark:text-gray-400">
                {`POST /api/connect
{
  "agent_id": "${agentId.trim()}",
  "side": "${side}",
  "category": "${resolvedCategory}",
  "params": {${skills.length > 0 ? `\n    "skills": ${JSON.stringify(skills)},` : ""}${rateMin ? `\n    "rate_min": ${rateMin},` : ""}${rateMax ? `\n    "rate_max": ${rateMax},` : ""}
    "currency": "${currency}",
    "remote": ${remote === "remote"}
  }${description ? `,\n  "description": "${description.trim()}"` : ""}
}`}
              </pre>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="w-full px-4 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 text-lg"
            >
              {loading ? "Submitting..." : "Submit listing"}
            </button>
          </div>
        )}

        {/* Success state */}
        {result && (
          <div className="space-y-6">
            <div className="text-center py-8">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold mb-2">You&apos;re connected!</h2>
              <p className="text-gray-600 dark:text-gray-400">
                Your listing is live. The platform will start finding matches for your agent.
              </p>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
              <p className="text-sm mb-1">
                <span className="text-gray-500">Profile ID:</span>{" "}
                <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm">
                  {result.profile_id}
                </code>
              </p>
              {result.replaced_profile_id && (
                <p className="text-sm text-gray-500 mt-1">
                  Replaced previous profile: {result.replaced_profile_id}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Link
                href="/browse"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-sm font-medium"
              >
                📋 Browse listings
              </Link>
              <Link
                href="/bounties"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-sm font-medium"
              >
                💰 View bounties
              </Link>
              <Link
                href="/dashboard"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-sm font-medium"
              >
                📊 Dashboard
              </Link>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setStep("side");
                  setSide("");
                  setAgentId("");
                  setCategory("");
                  setCustomCategory("");
                  setSkills([]);
                  setRateMin("");
                  setRateMax("");
                  setCurrency("EUR");
                  setRemote("remote");
                  setDescription("");
                  setError("");
                }}
                className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Connect another agent →
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
