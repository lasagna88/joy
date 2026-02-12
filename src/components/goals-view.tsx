"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Goal {
  id: string;
  title: string;
  description: string | null;
  weeklyHoursTarget: number | null;
  monthlyHoursTarget: number | null;
  color: string | null;
  isActive: boolean;
  createdAt: string;
}

interface GoalProgress {
  id: string;
  weeklyHoursTarget: number;
  weeklyHoursActual: number;
}

const colorOptions = [
  { value: "cyan", label: "Cyan", class: "bg-cyan-400" },
  { value: "pink", label: "Pink", class: "bg-pink-400" },
  { value: "amber", label: "Amber", class: "bg-amber-400" },
  { value: "green", label: "Green", class: "bg-green-400" },
  { value: "purple", label: "Purple", class: "bg-purple-400" },
  { value: "blue", label: "Blue", class: "bg-blue-400" },
];

export function GoalsView() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formHours, setFormHours] = useState("5");
  const [formColor, setFormColor] = useState("cyan");
  const [saving, setSaving] = useState(false);
  const [goalProgress, setGoalProgress] = useState<Record<string, GoalProgress>>({});

  async function fetchGoals() {
    try {
      const res = await fetch("/api/goals");
      if (res.ok) {
        const data = await res.json();
        setGoals(data.goals || []);
      }
    } catch {
      // Empty state
    } finally {
      setLoading(false);
    }
  }

  async function fetchProgress() {
    try {
      const res = await fetch("/api/analytics?period=week");
      if (res.ok) {
        const data = await res.json();
        const progressMap: Record<string, GoalProgress> = {};
        for (const gp of data.goalProgress || []) {
          progressMap[gp.id] = gp;
        }
        setGoalProgress(progressMap);
      }
    } catch {
      // Progress unavailable
    }
  }

  useEffect(() => {
    fetchGoals();
    fetchProgress();
  }, []);

  async function createGoal() {
    if (!formTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          weeklyHoursTarget: parseFloat(formHours) || 5,
          color: formColor,
        }),
      });
      if (res.ok) {
        setFormTitle("");
        setFormDescription("");
        setFormHours("5");
        setShowForm(false);
        await fetchGoals();
      }
    } catch {
      // Error
    } finally {
      setSaving(false);
    }
  }

  async function deleteGoal(id: string) {
    try {
      await fetch(`/api/goals/${id}`, { method: "DELETE" });
      setGoals((prev) => prev.filter((g) => g.id !== id));
    } catch {
      // Error
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Goals</h1>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-zinc-900 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Goals</h1>
        <div className="flex gap-2">
          <Link
            href="/analytics"
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            Analytics
          </Link>
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            {showForm ? "Cancel" : "+ Add"}
          </button>
        </div>
      </div>

      {/* New Goal Form */}
      {showForm && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <input
            type="text"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            placeholder="Goal title (e.g. Learn Spanish)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
            autoFocus
          />
          <textarea
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none resize-none"
          />
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs text-zinc-500 block mb-1">
                Weekly hours target
              </label>
              <input
                type="number"
                value={formHours}
                onChange={(e) => setFormHours(e.target.value)}
                min="0.5"
                step="0.5"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-zinc-500 block mb-1">Color</label>
              <div className="flex gap-2">
                {colorOptions.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setFormColor(c.value)}
                    className={`h-7 w-7 rounded-full ${c.class} ${
                      formColor === c.value
                        ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900"
                        : ""
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={createGoal}
            disabled={!formTitle.trim() || saving}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Goal"}
          </button>
        </div>
      )}

      {/* Goals List */}
      {goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg
            className="h-14 w-14 text-zinc-700 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5"
            />
          </svg>
          <p className="text-zinc-500 text-lg font-medium">No goals yet</p>
          <p className="text-zinc-600 text-sm mt-1">
            Add goals to protect time for what matters
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {goals.map((goal) => {
            const colorDot =
              colorOptions.find((c) => c.value === goal.color)?.class ||
              "bg-cyan-400";
            const progress = goalProgress[goal.id];
            const target = goal.weeklyHoursTarget || 0;
            const actual = progress?.weeklyHoursActual || 0;
            const pct = target > 0 ? Math.min((actual / target) * 100, 100) : 0;

            return (
              <div
                key={goal.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`h-3 w-3 rounded-full ${colorDot}`} />
                    <div>
                      <h3 className="font-semibold text-white">
                        {goal.title}
                      </h3>
                      {goal.description && (
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {goal.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteGoal(goal.id)}
                    className="text-zinc-600 hover:text-red-400 transition-colors p-1"
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
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-zinc-500">This week</span>
                    <span className="text-zinc-300 font-medium font-mono">
                      {actual}h / {target}h
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div
                      className={`h-2 rounded-full ${colorDot} transition-all`}
                      style={{ width: `${pct}%`, opacity: 0.8 }}
                    />
                  </div>
                  {pct >= 100 && (
                    <p className="text-[10px] text-green-400 mt-0.5">
                      Weekly target met!
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
