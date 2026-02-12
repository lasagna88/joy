"use client";

import { useState, useEffect } from "react";

interface SchedulingRule {
  id: string;
  text: string;
  goalId: string | null;
  goalTitle: string | null;
  isActive: boolean;
  createdAt: string;
}

interface Goal {
  id: string;
  title: string;
  color: string | null;
}

export function SchedulingRules() {
  const [rules, setRules] = useState<SchedulingRule[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formText, setFormText] = useState("");
  const [formGoalId, setFormGoalId] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchRules() {
    try {
      const res = await fetch("/api/scheduling-rules");
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch {
      // Empty state
    } finally {
      setLoading(false);
    }
  }

  async function fetchGoals() {
    try {
      const res = await fetch("/api/goals");
      if (res.ok) {
        const data = await res.json();
        setGoals(data.goals || []);
      }
    } catch {
      // Ignore
    }
  }

  useEffect(() => {
    fetchRules();
    fetchGoals();
  }, []);

  async function createRule() {
    if (!formText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/scheduling-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: formText.trim(),
          goalId: formGoalId || undefined,
        }),
      });
      if (res.ok) {
        setFormText("");
        setFormGoalId("");
        setShowForm(false);
        await fetchRules();
      }
    } catch {
      // Error
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(id: string) {
    try {
      await fetch(`/api/scheduling-rules/${id}`, { method: "DELETE" });
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // Error
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-zinc-900 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-200">
          Scheduling Rules
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <textarea
            value={formText}
            onChange={(e) => setFormText(e.target.value)}
            placeholder="e.g. Gym: 1hr blocks, 3x per week, between 6am and 8am"
            rows={2}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none resize-none"
            autoFocus
          />
          {goals.length > 0 && (
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Link to goal (optional)
              </label>
              <select
                value={formGoalId}
                onChange={(e) => setFormGoalId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white [color-scheme:dark]"
              >
                <option value="">No linked goal</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={createRule}
            disabled={!formText.trim() || saving}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add Rule"}
          </button>
        </div>
      )}

      {rules.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <svg
            className="h-10 w-10 text-zinc-700 mb-2"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
          </svg>
          <p className="text-zinc-500 text-sm">No scheduling rules yet</p>
          <p className="text-zinc-600 text-xs mt-0.5">
            Add rules so Joy respects your recurring commitments
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-start justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white">{rule.text}</p>
                {rule.goalTitle && (
                  <span className="inline-block mt-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                    {rule.goalTitle}
                  </span>
                )}
              </div>
              <button
                onClick={() => deleteRule(rule.id)}
                className="ml-3 flex-shrink-0 text-zinc-600 hover:text-red-400 transition-colors p-1"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
