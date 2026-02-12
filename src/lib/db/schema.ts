import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  pgEnum,
  jsonb,
  real,
} from "drizzle-orm/pg-core";

// Enums
export const taskStatusEnum = pgEnum("task_status", [
  "inbox",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "urgent",
  "high",
  "medium",
  "low",
]);

export const taskCategoryEnum = pgEnum("task_category", [
  "door_knocking",
  "appointment",
  "follow_up",
  "admin",
  "goal_work",
  "personal",
  "other",
]);

export const eventSourceEnum = pgEnum("event_source", [
  "ai_planned",
  "manual",
  "google_calendar",
  "bigin",
  "salesrabbit",
]);

// Tasks - what needs to be done
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("inbox"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  category: taskCategoryEnum("category").notNull().default("other"),
  estimatedMinutes: integer("estimated_minutes"),
  deadline: timestamp("deadline", { withTimezone: true }),
  location: text("location"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  goalId: uuid("goal_id").references(() => goals.id),
  externalId: text("external_id"),
  externalSource: text("external_source"),
  metadata: jsonb("metadata"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Calendar Events - when things are scheduled
export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  location: text("location"),
  taskId: uuid("task_id").references(() => tasks.id),
  source: eventSourceEnum("source").notNull().default("ai_planned"),
  googleEventId: text("google_event_id"),
  isBlocker: boolean("is_blocker").notNull().default(false),
  color: text("color"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Goals - long-term objectives
export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  weeklyHoursTarget: real("weekly_hours_target"),
  monthlyHoursTarget: real("monthly_hours_target"),
  color: text("color"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Conversations - chat threads with the AI
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Messages - individual messages in conversations
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  toolResults: jsonb("tool_results"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Integration State - credentials and sync cursors
export const integrationState = pgTable("integration_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().unique(), // "google" | "bigin" | "salesrabbit"
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  syncCursor: text("sync_cursor"),
  config: jsonb("config"),
  isActive: boolean("is_active").notNull().default(false),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// User Preferences - work hours, planning rules, etc.
export const userPreferences = pgTable("user_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Push Subscriptions - for web push notifications
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Notifications - log of sent notifications
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull(), // "morning_briefing" | "reminder" | "replan" | etc.
  sentAt: timestamp("sent_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Type exports for use in app code
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type UserPreference = typeof userPreferences.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
