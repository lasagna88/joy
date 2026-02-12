import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { and, gte, lt } from "drizzle-orm";

export async function GET() {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const events = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          gte(calendarEvents.startTime, startOfDay),
          lt(calendarEvents.startTime, endOfDay)
        )
      )
      .orderBy(calendarEvents.startTime);

    return NextResponse.json({ events });
  } catch (error) {
    console.error("Failed to fetch today events:", error);
    return NextResponse.json({ events: [] });
  }
}
