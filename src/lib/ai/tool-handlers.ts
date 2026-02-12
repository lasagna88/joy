import { db } from "@/lib/db";
import { tasks, calendarEvents, goals, schedulingRules, groceryItems } from "@/lib/db/schema";
import { eq, and, ne, gte, lt, desc } from "drizzle-orm";
import { getPreferences } from "@/lib/preferences";
import {
  pushEventToGoogle,
  deleteGoogleEvent,
  isConnected as isGoogleConnected,
} from "@/lib/google-calendar";

type ToolInput = Record<string, unknown>;

export async function handleToolCall(
  name: string,
  input: ToolInput
): Promise<string> {
  switch (name) {
    case "create_task":
      return handleCreateTask(input);
    case "update_task":
      return handleUpdateTask(input);
    case "list_tasks":
      return handleListTasks(input);
    case "create_calendar_event":
      return handleCreateCalendarEvent(input);
    case "delete_calendar_event":
      return handleDeleteCalendarEvent(input);
    case "list_events":
      return handleListEvents(input);
    case "list_events_today":
      return handleListEvents({});
    case "clear_day_schedule":
      return handleClearDaySchedule(input);
    case "get_preferences":
      return handleGetPreferences();
    case "list_goals":
      return handleListGoals();
    case "list_scheduling_rules":
      return handleListSchedulingRules();
    case "create_goal":
      return handleCreateGoal(input);
    case "add_grocery_item":
      return handleAddGroceryItem(input);
    case "list_grocery_items":
      return handleListGroceryItems();
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

async function handleCreateTask(input: ToolInput): Promise<string> {
  const [task] = await db
    .insert(tasks)
    .values({
      title: input.title as string,
      description: (input.description as string) || undefined,
      priority: input.priority as "urgent" | "high" | "medium" | "low",
      category: input.category as
        | "door_knocking"
        | "appointment"
        | "follow_up"
        | "admin"
        | "goal_work"
        | "personal"
        | "other",
      estimatedMinutes: (input.estimated_minutes as number) || undefined,
      deadline: input.deadline
        ? new Date(input.deadline as string)
        : undefined,
      location: (input.location as string) || undefined,
      contactName: (input.contact_name as string) || undefined,
      contactPhone: (input.contact_phone as string) || undefined,
    })
    .returning();

  return JSON.stringify({
    success: true,
    task: {
      id: task.id,
      title: task.title,
      priority: task.priority,
      category: task.category,
      status: task.status,
    },
  });
}

async function handleUpdateTask(input: ToolInput): Promise<string> {
  const taskId = input.task_id as string;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.status) updates.status = input.status;
  if (input.priority) updates.priority = input.priority;
  if (input.title) updates.title = input.title;
  if (input.description) updates.description = input.description;
  if (input.status === "completed") updates.completedAt = new Date();

  const [updated] = await db
    .update(tasks)
    .set(updates)
    .where(eq(tasks.id, taskId))
    .returning();

  if (!updated) {
    return JSON.stringify({ error: "Task not found" });
  }

  return JSON.stringify({
    success: true,
    task: {
      id: updated.id,
      title: updated.title,
      status: updated.status,
      priority: updated.priority,
    },
  });
}

async function handleListTasks(input: ToolInput): Promise<string> {
  const limit = (input.limit as number) || 20;
  const conditions = [];

  if (input.status) {
    conditions.push(
      eq(
        tasks.status,
        input.status as
          | "inbox"
          | "scheduled"
          | "in_progress"
          | "completed"
          | "cancelled"
      )
    );
  } else {
    conditions.push(ne(tasks.status, "completed"));
    conditions.push(ne(tasks.status, "cancelled"));
  }

  if (input.category) {
    conditions.push(
      eq(
        tasks.category,
        input.category as
          | "door_knocking"
          | "appointment"
          | "follow_up"
          | "admin"
          | "goal_work"
          | "personal"
          | "other"
      )
    );
  }

  const result = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt))
    .limit(limit);

  return JSON.stringify({
    count: result.length,
    tasks: result.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      category: t.category,
      deadline: t.deadline,
      location: t.location,
      contactName: t.contactName,
      estimatedMinutes: t.estimatedMinutes,
    })),
  });
}

async function handleCreateCalendarEvent(input: ToolInput): Promise<string> {
  // Map the category string to a color for display
  const categoryColorMap: Record<string, string> = {
    door_knocking: "green",
    appointment: "blue",
    follow_up: "amber",
    admin: "purple",
    goal_work: "cyan",
    personal: "pink",
    exercise: "rose",
    errands: "orange",
    partner_time: "red",
    meal_prep: "lime",
    cleaning: "teal",
    lunch: "yellow",
    travel: "slate",
    buffer: "zinc",
    other: "zinc",
  };

  const category = (input.category as string) || "other";

  const [event] = await db
    .insert(calendarEvents)
    .values({
      title: input.title as string,
      description: (input.description as string) || undefined,
      startTime: new Date(input.start_time as string),
      endTime: new Date(input.end_time as string),
      location: (input.location as string) || undefined,
      taskId: (input.task_id as string) || undefined,
      source: "ai_planned",
      isBlocker: (input.is_blocker as boolean) || false,
      color: categoryColorMap[category] || "zinc",
      metadata: { category },
    })
    .returning();

  // Push to Google Calendar if connected
  let googleEventId: string | null = null;
  try {
    if (await isGoogleConnected()) {
      googleEventId = await pushEventToGoogle({
        id: event.id,
        title: event.title,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location,
      });
    }
  } catch (err) {
    console.error("[tool] Failed to push event to Google Calendar:", err);
  }

  return JSON.stringify({
    success: true,
    event: {
      id: event.id,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      googleEventId,
    },
  });
}

async function handleDeleteCalendarEvent(input: ToolInput): Promise<string> {
  const eventId = input.event_id as string;

  const [deleted] = await db
    .delete(calendarEvents)
    .where(eq(calendarEvents.id, eventId))
    .returning();

  if (!deleted) {
    return JSON.stringify({ error: "Event not found" });
  }

  // Remove from Google Calendar if it was synced
  if (deleted.googleEventId) {
    try {
      await deleteGoogleEvent(deleted.googleEventId);
    } catch (err) {
      console.error("[tool] Failed to delete Google Calendar event:", err);
    }
  }

  return JSON.stringify({ success: true, deleted: deleted.id });
}

async function handleListEvents(input: ToolInput): Promise<string> {
  const prefs = await getPreferences();
  const tz = prefs.timezone || "America/Denver";
  let startDate: Date;
  let endDate: Date;

  if (input.date) {
    // AI sends a date like "2025-03-15" — compute day boundaries in user's tz
    const dateStr = (input.date as string).slice(0, 10); // ensure YYYY-MM-DD
    const { startOfDayUTC, endOfDayUTC } = await import("@/lib/timezone");
    const ref = new Date(`${dateStr}T12:00:00Z`); // noon UTC as reference
    startDate = startOfDayUTC(tz, ref);
    endDate = endOfDayUTC(tz, ref);
  } else if (input.start_date && input.end_date) {
    startDate = new Date(input.start_date as string);
    endDate = new Date(input.end_date as string);
  } else {
    // Default to today
    const { startOfDayUTC, endOfDayUTC } = await import("@/lib/timezone");
    startDate = startOfDayUTC(tz);
    endDate = endOfDayUTC(tz);
  }

  const events = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        gte(calendarEvents.startTime, startDate),
        lt(calendarEvents.startTime, endDate)
      )
    )
    .orderBy(calendarEvents.startTime);

  return JSON.stringify({
    count: events.length,
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      source: e.source,
      isBlocker: e.isBlocker,
      category: (e.metadata as Record<string, unknown>)?.category || "other",
    })),
  });
}

async function handleClearDaySchedule(input: ToolInput): Promise<string> {
  const prefs = await getPreferences();
  const tz = prefs.timezone || "America/Denver";
  const dateStr = (input.date as string).slice(0, 10);
  const { startOfDayUTC, endOfDayUTC } = await import("@/lib/timezone");
  const ref = new Date(`${dateStr}T12:00:00Z`);
  const startOfDay = startOfDayUTC(tz, ref);
  const endOfDay = endOfDayUTC(tz, ref);

  // Delete AI-planned events only (keep blockers and external events)
  const deleted = await db
    .delete(calendarEvents)
    .where(
      and(
        gte(calendarEvents.startTime, startOfDay),
        lt(calendarEvents.startTime, endOfDay),
        eq(calendarEvents.source, "ai_planned"),
        eq(calendarEvents.isBlocker, false)
      )
    )
    .returning();

  // Remove from Google Calendar if synced
  for (const event of deleted) {
    if (event.googleEventId) {
      try {
        await deleteGoogleEvent(event.googleEventId);
      } catch (err) {
        console.error("[tool] Failed to delete Google event:", err);
      }
    }
  }

  return JSON.stringify({
    success: true,
    deleted_count: deleted.length,
  });
}

async function handleGetPreferences(): Promise<string> {
  const prefs = await getPreferences();
  return JSON.stringify(prefs);
}

async function handleListGoals(): Promise<string> {
  const result = await db
    .select()
    .from(goals)
    .where(eq(goals.isActive, true))
    .orderBy(goals.createdAt);

  return JSON.stringify({
    count: result.length,
    goals: result.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      type: g.type,
      sessionDuration: g.sessionDuration,
      frequency: g.frequency,
      weeklyHoursTarget: g.weeklyHoursTarget,
      color: g.color,
    })),
  });
}

const frequencyLabelsForRule: Record<string, string> = {
  daily: "daily",
  "2x_per_week": "2 sessions per week",
  "3x_per_week": "3 sessions per week",
  "4x_per_week": "4 sessions per week",
  "5x_per_week": "5 sessions per week",
  weekly: "1 session per week",
  biweekly: "every 2 weeks",
  monthly: "1 session per month",
  "2x_per_month": "2 sessions per month",
  "3x_per_month": "3 sessions per month",
};

async function handleCreateGoal(input: ToolInput): Promise<string> {
  const goalType = (input.type as string) || "personal";
  const frequency = input.frequency as string | undefined;
  const sessionDuration = input.session_duration as number | undefined;

  const [goal] = await db
    .insert(goals)
    .values({
      title: input.title as string,
      description: (input.description as string) || undefined,
      type: goalType,
      sessionDuration: sessionDuration || undefined,
      frequency: frequency || undefined,
      weeklyHoursTarget: input.weekly_hours_target as number,
      color: (input.color as string) || "cyan",
    })
    .returning();

  // Auto-create a linked scheduling rule when frequency + duration are provided
  let ruleText: string | undefined;
  if (frequency && sessionDuration) {
    const freqLabel = frequencyLabelsForRule[frequency] || frequency;
    const durHours = sessionDuration >= 60
      ? `${sessionDuration / 60} hour${sessionDuration > 60 ? "s" : ""}`
      : `${sessionDuration} minutes`;
    const timeSlot = goalType === "personal"
      ? "personal time only (outside work hours)"
      : "during work hours";

    ruleText = `${goal.title}: ${freqLabel}, ${durHours} each, ${timeSlot}`;
    await db.insert(schedulingRules).values({
      text: ruleText,
      goalId: goal.id,
    });
  }

  return JSON.stringify({
    success: true,
    goal: {
      id: goal.id,
      title: goal.title,
      type: goal.type,
      frequency: goal.frequency,
      sessionDuration: goal.sessionDuration,
      weeklyHoursTarget: goal.weeklyHoursTarget,
    },
    schedulingRule: ruleText || null,
  });
}

async function handleAddGroceryItem(input: ToolInput): Promise<string> {
  const [item] = await db
    .insert(groceryItems)
    .values({ name: input.name as string })
    .returning();

  return JSON.stringify({
    success: true,
    item: { id: item.id, name: item.name },
  });
}

async function handleListGroceryItems(): Promise<string> {
  const unchecked = await db
    .select()
    .from(groceryItems)
    .where(eq(groceryItems.checked, false))
    .orderBy(desc(groceryItems.createdAt));

  const checked = await db
    .select()
    .from(groceryItems)
    .where(eq(groceryItems.checked, true))
    .orderBy(desc(groceryItems.checkedAt));

  const items = [...unchecked, ...checked];

  return JSON.stringify({
    count: items.length,
    unchecked_count: unchecked.length,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      checked: i.checked,
    })),
  });
}

async function handleListSchedulingRules(): Promise<string> {
  const result = await db
    .select({
      id: schedulingRules.id,
      text: schedulingRules.text,
      goalTitle: goals.title,
    })
    .from(schedulingRules)
    .leftJoin(goals, eq(schedulingRules.goalId, goals.id))
    .where(eq(schedulingRules.isActive, true))
    .orderBy(schedulingRules.createdAt);

  return JSON.stringify({
    count: result.length,
    rules: result.map((r) => ({
      id: r.id,
      text: r.text,
      goalTitle: r.goalTitle || undefined,
    })),
  });
}
