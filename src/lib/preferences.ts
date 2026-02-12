import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface UserPrefs {
  timezone: string;
  work_start: string; // "08:00"
  work_end: string; // "18:00"
  lunch_start: string; // "12:00"
  lunch_duration_minutes: number;
  buffer_minutes: number; // between events
  travel_buffer_minutes: number; // before/after appointments with locations
  min_slack_minutes: number; // daily unscheduled time
  door_knocking_start: string; // "10:00"
  door_knocking_end: string; // "17:00"
}

export const DEFAULT_PREFERENCES: UserPrefs = {
  timezone: "America/Denver",
  work_start: "08:00",
  work_end: "18:00",
  lunch_start: "12:00",
  lunch_duration_minutes: 30,
  buffer_minutes: 15,
  travel_buffer_minutes: 30,
  min_slack_minutes: 30,
  door_knocking_start: "10:00",
  door_knocking_end: "17:00",
};

export async function getPreferences(): Promise<UserPrefs> {
  try {
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.key, "scheduling"));

    if (rows.length > 0) {
      return { ...DEFAULT_PREFERENCES, ...(rows[0].value as Partial<UserPrefs>) };
    }
  } catch {
    // DB not available yet, return defaults
  }
  return DEFAULT_PREFERENCES;
}

export async function setPreferences(prefs: Partial<UserPrefs>): Promise<UserPrefs> {
  const current = await getPreferences();
  const merged = { ...current, ...prefs };

  await db
    .insert(userPreferences)
    .values({
      key: "scheduling",
      value: merged,
    })
    .onConflictDoUpdate({
      target: userPreferences.key,
      set: { value: merged, updatedAt: new Date() },
    });

  return merged;
}
