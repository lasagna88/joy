import type Anthropic from "@anthropic-ai/sdk";

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_task",
    description:
      "Create a new task in Scott's inbox. Use this when Scott mentions something he needs to do, an appointment, a follow-up, or any actionable item.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Short, clear title for the task",
        },
        description: {
          type: "string",
          description: "Additional details or context",
        },
        priority: {
          type: "string",
          enum: ["urgent", "high", "medium", "low"],
          description:
            "Task priority. Use urgent for same-day deadlines, high for this-week deadlines.",
        },
        category: {
          type: "string",
          enum: [
            "door_knocking",
            "appointment",
            "follow_up",
            "admin",
            "goal_work",
            "personal",
            "other",
          ],
          description:
            "Task category. appointment = customer meetings, follow_up = callbacks/emails, door_knocking = canvassing blocks, personal = personal life items (exercise, errands, partner time, cleaning, etc).",
        },
        estimated_minutes: {
          type: "number",
          description: "Estimated time in minutes to complete this task",
        },
        deadline: {
          type: "string",
          description:
            "ISO 8601 deadline if mentioned (e.g. 2025-03-15T14:00:00)",
        },
        location: {
          type: "string",
          description: "Address or location if relevant",
        },
        contact_name: {
          type: "string",
          description: "Customer or contact name if mentioned",
        },
        contact_phone: {
          type: "string",
          description: "Phone number if mentioned",
        },
      },
      required: ["title", "priority", "category"],
    },
  },
  {
    name: "update_task",
    description:
      "Update an existing task — change status, priority, or other fields. Use this when Scott says he's done with something, wants to cancel a task, or change details.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: {
          type: "string",
          description: "The UUID of the task to update",
        },
        status: {
          type: "string",
          enum: [
            "inbox",
            "scheduled",
            "in_progress",
            "completed",
            "cancelled",
          ],
          description: "New status for the task",
        },
        priority: {
          type: "string",
          enum: ["urgent", "high", "medium", "low"],
        },
        title: {
          type: "string",
          description: "Updated title",
        },
        description: {
          type: "string",
          description: "Updated description",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "list_tasks",
    description:
      "Retrieve tasks from the database. Use this to check what's in the inbox, see scheduled items, or find tasks to reference.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: [
            "inbox",
            "scheduled",
            "in_progress",
            "completed",
            "cancelled",
          ],
          description: "Filter by status. Omit to get all non-completed tasks.",
        },
        category: {
          type: "string",
          enum: [
            "door_knocking",
            "appointment",
            "follow_up",
            "admin",
            "goal_work",
            "personal",
            "other",
          ],
          description: "Filter by category (personal includes exercise, errands, partner_time, etc.)",
        },
        limit: {
          type: "number",
          description: "Max number of tasks to return (default 20)",
        },
      },
      required: [],
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Create a calendar event (time block) on a specific date. Use this when planning a day or scheduling a specific task into a time slot.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Event title (e.g. 'Door Knocking - Oak Park', 'Lunch Break', 'Follow-up Calls')",
        },
        description: {
          type: "string",
          description: "Additional details",
        },
        start_time: {
          type: "string",
          description: "ISO 8601 start time (e.g. 2025-03-15T10:00:00)",
        },
        end_time: {
          type: "string",
          description: "ISO 8601 end time (e.g. 2025-03-15T17:00:00)",
        },
        location: {
          type: "string",
          description: "Address or area",
        },
        task_id: {
          type: "string",
          description: "UUID of the task this event is for (links event to task)",
        },
        category: {
          type: "string",
          enum: [
            "door_knocking",
            "appointment",
            "follow_up",
            "admin",
            "goal_work",
            "personal",
            "exercise",
            "errands",
            "partner_time",
            "meal_prep",
            "cleaning",
            "lunch",
            "travel",
            "buffer",
            "other",
          ],
          description: "Category for color coding. Use personal subtypes for specific personal activities: exercise, errands, partner_time, meal_prep, cleaning. Use 'lunch' for lunch breaks, 'travel' for travel buffers, 'buffer' for transition time.",
        },
        is_blocker: {
          type: "boolean",
          description: "If true, this event can't be moved during replanning (e.g. external appointments)",
        },
      },
      required: ["title", "start_time", "end_time"],
    },
  },
  {
    name: "delete_calendar_event",
    description:
      "Delete a calendar event. Use when clearing a day's schedule for replanning, or removing a single event.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The UUID of the event to delete",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "list_events",
    description:
      "List calendar events for a given date or date range. Use this to see what's already scheduled before planning.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "ISO 8601 date (e.g. 2025-03-15) to list events for a single day",
        },
        start_date: {
          type: "string",
          description: "Start of date range (ISO 8601)",
        },
        end_date: {
          type: "string",
          description: "End of date range (ISO 8601)",
        },
      },
      required: [],
    },
  },
  {
    name: "clear_day_schedule",
    description:
      "Remove all AI-planned events for a specific date (keeps blocker events and external events). Use before replanning a day.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "ISO 8601 date to clear (e.g. 2025-03-15)",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "get_preferences",
    description:
      "Get Scott's scheduling preferences (work hours, lunch time, buffer durations, etc.)",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_goals",
    description:
      "List active goals with their weekly hour targets.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "create_goal",
    description:
      "Create a new goal with a weekly hours target.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Goal title (e.g. 'Learn Spanish', 'Fitness')",
        },
        description: {
          type: "string",
          description: "Goal details",
        },
        weekly_hours_target: {
          type: "number",
          description: "Target hours per week for this goal",
        },
        color: {
          type: "string",
          description: "Color for calendar events (e.g. 'cyan', 'pink', 'amber')",
        },
      },
      required: ["title", "weekly_hours_target"],
    },
  },
];
