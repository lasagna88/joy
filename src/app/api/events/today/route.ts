import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { and, gte, lt } from "drizzle-orm";
import { getPreferences } from "@/lib/preferences";
import { startOfDayUTC, endOfDayUTC } from "@/lib/timezone";

export async function GET() {
  try {
    const prefs = await getPreferences();
    const tz = prefs.timezone || "America/Denver";

    const start = startOfDayUTC(tz);
    const end = endOfDayUTC(tz);

    const events = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          gte(calendarEvents.startTime, start),
          lt(calendarEvents.startTime, end)
        )
      )
      .orderBy(calendarEvents.startTime);

    return NextResponse.json({ events });
  } catch (error) {
    console.error("Failed to fetch today events:", error);
    return NextResponse.json({ events: [] });
  }
}
