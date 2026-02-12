"use client";

import { useState, useEffect, useCallback } from "react";

interface AnalyticsData {
  period: string;
  summary: {
    totalHours: number;
    completedHours: number;
    tasksCompleted: number;
    streak: number;
  };
  tasksByStatus: Record<string, number>;
  dailyBreakdown: { date: string; dayName: string; hours: number }[];
  categoryBreakdown: {
    category: string;
    hours: number;
    percentage: number;
  }[];
  goalProgress: {
    id: string;
    title: string;
    color: string | null;
    weeklyHoursTarget: number;
    weeklyHoursActual: number;
    periodHoursActual: number;
  }[];
}

const categoryLabels: Record<string, string> = {
  door_knocking: "Door Knocking",
  appointment: "Appointments",
  follow_up: "Follow-ups",
  admin: "Admin",
  goal_work: "Goal Work",
  personal: "Personal",
  exercise: "Exercise",
  errands: "Errands",
  partner_time: "Partner Time",
  meal_prep: "Meal Prep",
  cleaning: "Cleaning",
  lunch: "Lunch",
  travel: "Travel",
  buffer: "Buffer",
  other: "Other",
};

const categoryColors: Record<string, string> = {
  door_knocking: "bg-green-400",
  appointment: "bg-blue-400",
  follow_up: "bg-amber-400",
  admin: "bg-purple-400",
  goal_work: "bg-cyan-400",
  personal: "bg-pink-400",
  exercise: "bg-rose-400",
  errands: "bg-orange-400",
  partner_time: "bg-red-400",
  meal_prep: "bg-lime-400",
  cleaning: "bg-teal-400",
  lunch: "bg-yellow-400",
  travel: "bg-slate-400",
  buffer: "bg-zinc-500",
  other: "bg-zinc-400",
};

const goalColorMap: Record<string, string> = {
  cyan: "bg-cyan-400",
  pink: "bg-pink-400",
  amber: "bg-amber-400",
  green: "bg-green-400",
  purple: "bg-purple-400",
  blue: "bg-blue-400",
};

export function AnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Show empty state
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl bg-zinc-900 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-zinc-500">No data available yet. Plan some days first!</p>
      </div>
    );
  }

  const maxDailyHours = Math.max(
    ...data.dailyBreakdown.map((d) => d.hours),
    1
  );

  return (
    <div className="space-y-5">
      {/* Header + Period Toggle */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <div className="flex rounded-lg border border-zinc-700 bg-zinc-900 p-0.5">
          <button
            onClick={() => setPeriod("week")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              period === "week"
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setPeriod("month")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              period === "month"
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Month
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            Scheduled
          </p>
          <p className="text-2xl font-bold text-white mt-1">
            {data.summary.totalHours}
            <span className="text-sm font-normal text-zinc-500">h</span>
          </p>
          <p className="text-xs text-zinc-600 mt-0.5">
            {data.summary.completedHours}h completed
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            Tasks Done
          </p>
          <p className="text-2xl font-bold text-white mt-1">
            {data.summary.tasksCompleted}
          </p>
          <p className="text-xs text-zinc-600 mt-0.5">
            {period === "week" ? "this week" : "this month"}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            Streak
          </p>
          <p className="text-2xl font-bold text-white mt-1">
            {data.summary.streak}
            <span className="text-sm font-normal text-zinc-500"> days</span>
          </p>
          <p className="text-xs text-zinc-600 mt-0.5">weekdays with 4h+</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            Inbox
          </p>
          <p className="text-2xl font-bold text-white mt-1">
            {data.tasksByStatus?.inbox || 0}
          </p>
          <p className="text-xs text-zinc-600 mt-0.5">tasks waiting</p>
        </div>
      </div>

      {/* Daily Activity Chart */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Daily Activity
        </h2>
        <div className="flex items-end gap-1 h-24">
          {data.dailyBreakdown.map((day) => {
            const heightPct = maxDailyHours
              ? (day.hours / maxDailyHours) * 100
              : 0;
            const isToday =
              day.date ===
              new Date().toISOString().split("T")[0];
            return (
              <div
                key={day.date}
                className="flex-1 flex flex-col items-center gap-1"
              >
                <div
                  className="w-full relative group"
                  style={{ height: "80px" }}
                >
                  <div
                    className={`absolute bottom-0 w-full rounded-t transition-all ${
                      isToday ? "bg-blue-500" : "bg-zinc-700"
                    }`}
                    style={{
                      height: `${Math.max(heightPct, 2)}%`,
                    }}
                  />
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 hidden group-hover:block bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-300 whitespace-nowrap z-10">
                    {day.hours}h
                  </div>
                </div>
                <span
                  className={`text-[10px] ${
                    isToday ? "text-blue-400 font-medium" : "text-zinc-600"
                  }`}
                >
                  {day.dayName}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category Breakdown */}
      {data.categoryBreakdown.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Time by Category
          </h2>
          <div className="space-y-2.5">
            {data.categoryBreakdown
              .filter((c) => c.category !== "buffer" && c.category !== "travel")
              .map((cat) => (
                <div key={cat.category}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          categoryColors[cat.category] || "bg-zinc-400"
                        }`}
                      />
                      <span className="text-zinc-300">
                        {categoryLabels[cat.category] || cat.category}
                      </span>
                    </div>
                    <span className="text-zinc-500 font-mono">
                      {cat.hours}h ({cat.percentage}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        categoryColors[cat.category] || "bg-zinc-400"
                      }`}
                      style={{ width: `${cat.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Goal Progress */}
      {data.goalProgress.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Goal Progress (This Week)
          </h2>
          <div className="space-y-4">
            {data.goalProgress.map((goal) => {
              const pct =
                goal.weeklyHoursTarget > 0
                  ? Math.min(
                      (goal.weeklyHoursActual / goal.weeklyHoursTarget) * 100,
                      100
                    )
                  : 0;
              const colorClass =
                goalColorMap[goal.color || "cyan"] || "bg-cyan-400";
              return (
                <div key={goal.id}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${colorClass}`}
                      />
                      <span className="text-zinc-200 font-medium">
                        {goal.title}
                      </span>
                    </div>
                    <span className="text-zinc-400 font-mono">
                      {goal.weeklyHoursActual}h / {goal.weeklyHoursTarget}h
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div
                      className={`h-2 rounded-full transition-all ${colorClass}`}
                      style={{ width: `${pct}%`, opacity: 0.8 }}
                    />
                  </div>
                  {pct >= 100 && (
                    <p className="text-[10px] text-green-400 mt-0.5">
                      Target met!
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
