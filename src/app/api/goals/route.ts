import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { goals, schedulingRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const result = await db
      .select()
      .from(goals)
      .where(eq(goals.isActive, true))
      .orderBy(goals.createdAt);

    return NextResponse.json({ goals: result });
  } catch (error) {
    console.error("Failed to fetch goals:", error);
    return NextResponse.json({ goals: [] });
  }
}

const frequencyLabels: Record<string, string> = {
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const [goal] = await db
      .insert(goals)
      .values({
        title: body.title,
        description: body.description,
        type: body.type || "personal",
        sessionDuration: body.sessionDuration || undefined,
        frequency: body.frequency || undefined,
        weeklyHoursTarget: body.weeklyHoursTarget,
        monthlyHoursTarget: body.monthlyHoursTarget,
        color: body.color || "cyan",
      })
      .returning();

    // Auto-create a linked scheduling rule when frequency + duration are provided
    if (body.frequency && body.sessionDuration) {
      const freqLabel = frequencyLabels[body.frequency] || body.frequency;
      const durHours = body.sessionDuration >= 60
        ? `${body.sessionDuration / 60} hour${body.sessionDuration > 60 ? "s" : ""}`
        : `${body.sessionDuration} minutes`;
      const timeSlot = (body.type || "personal") === "personal"
        ? "personal time only (outside work hours)"
        : "during work hours";

      await db.insert(schedulingRules).values({
        text: `${goal.title}: ${freqLabel}, ${durHours} each, ${timeSlot}`,
        goalId: goal.id,
      });
    }

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error("Failed to create goal:", error);
    return NextResponse.json(
      { error: "Failed to create goal" },
      { status: 500 }
    );
  }
}
