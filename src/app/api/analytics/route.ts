import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarEvents, tasks, goals } from "@/lib/db/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";

/**
 * GET /api/analytics?period=week|month
 *
 * Returns:
 * - summary: total hours scheduled/completed, tasks completed count
 * - dailyBreakdown: hours per day for the last 7 or 30 days
 * - categoryBreakdown: hours per category
 * - goalProgress: actual hours vs target for each goal
 * - streaks: consecutive days with schedule followed
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "week";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysBack = period === "month" ? 30 : 7;
  const startDate = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const endDate = new Date(today.getTime() + 24 * 60 * 60 * 1000); // End of today

  try {
    // 1. Fetch all events in the period
    const events = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          gte(calendarEvents.startTime, startDate),
          lt(calendarEvents.startTime, endDate)
        )
      );

    // 2. Calculate total hours
    let totalMinutes = 0;
    let completedMinutes = 0;
    const categoryMinutes: Record<string, number> = {};
    const dailyMinutes: Record<string, number> = {};
    const goalMinutes: Record<string, number> = {};

    for (const event of events) {
      const duration =
        (event.endTime.getTime() - event.startTime.getTime()) / 60000;
      const category =
        (event.metadata as Record<string, string>)?.category || "other";
      const dateKey = event.startTime.toISOString().split("T")[0];
      const isPast = event.endTime.getTime() < now.getTime();

      totalMinutes += duration;
      if (isPast) completedMinutes += duration;

      // Category breakdown
      categoryMinutes[category] = (categoryMinutes[category] || 0) + duration;

      // Daily breakdown
      dailyMinutes[dateKey] = (dailyMinutes[dateKey] || 0) + duration;

      // Goal tracking — if the event's task is linked to a goal
      if (event.taskId) {
        const [task] = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, event.taskId));
        if (task?.goalId) {
          goalMinutes[task.goalId] =
            (goalMinutes[task.goalId] || 0) + duration;
        }
      }

      // Also track goal_work category events
      if (category === "goal_work" && !event.taskId) {
        // Count as general goal work
        goalMinutes["_general"] =
          (goalMinutes["_general"] || 0) + duration;
      }
    }

    // 3. Tasks completed in period
    const completedTasks = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "completed"),
          gte(tasks.completedAt, startDate),
          lt(tasks.completedAt, endDate)
        )
      );

    const tasksCompletedCount = completedTasks[0]?.count || 0;

    // 4. Tasks by status
    const tasksByStatus = await db
      .select({
        status: tasks.status,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .groupBy(tasks.status);

    // 5. Goal progress
    const activeGoals = await db
      .select()
      .from(goals)
      .where(eq(goals.isActive, true));

    // Calculate this week's goal hours (Mon-Sun of current week)
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(today.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const weekEvents = events.filter(
      (e) =>
        e.startTime >= weekStart && e.startTime < weekEnd
    );

    const weekGoalMinutes: Record<string, number> = {};
    for (const event of weekEvents) {
      if (event.taskId) {
        const [task] = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, event.taskId));
        if (task?.goalId) {
          weekGoalMinutes[task.goalId] =
            (weekGoalMinutes[task.goalId] || 0) +
            (event.endTime.getTime() - event.startTime.getTime()) / 60000;
        }
      }
    }

    const goalProgress = activeGoals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      color: goal.color,
      weeklyHoursTarget: goal.weeklyHoursTarget || 0,
      weeklyHoursActual:
        Math.round(((weekGoalMinutes[goal.id] || 0) / 60) * 10) / 10,
      periodHoursActual:
        Math.round(((goalMinutes[goal.id] || 0) / 60) * 10) / 10,
    }));

    // 6. Daily breakdown array (sorted)
    const dailyBreakdown = [];
    for (let i = 0; i < daysBack; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split("T")[0];
      dailyBreakdown.push({
        date: key,
        dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
        hours: Math.round(((dailyMinutes[key] || 0) / 60) * 10) / 10,
      });
    }

    // 7. Category breakdown array (sorted by hours desc)
    const categoryBreakdown = Object.entries(categoryMinutes)
      .map(([category, minutes]) => ({
        category,
        hours: Math.round((minutes / 60) * 10) / 10,
        percentage: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
      }))
      .sort((a, b) => b.hours - a.hours);

    // 8. Streak calculation — consecutive days (backwards from today) with >= 4 hours scheduled
    let streak = 0;
    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split("T")[0];
      const dayHours = (dailyMinutes[key] || 0) / 60;
      // Only count weekdays (Mon-Fri) for streak
      const dayOfWeek = d.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      if (d > today) continue;

      if (dayHours >= 4) {
        streak++;
      } else {
        break;
      }
    }

    return NextResponse.json({
      period,
      summary: {
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        completedHours: Math.round((completedMinutes / 60) * 10) / 10,
        tasksCompleted: tasksCompletedCount,
        streak,
      },
      tasksByStatus: Object.fromEntries(
        tasksByStatus.map((t) => [t.status, t.count])
      ),
      dailyBreakdown,
      categoryBreakdown,
      goalProgress,
    });
  } catch (error) {
    console.error("[api/analytics] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
