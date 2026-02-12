import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const [goal] = await db
      .insert(goals)
      .values({
        title: body.title,
        description: body.description,
        weeklyHoursTarget: body.weeklyHoursTarget,
        monthlyHoursTarget: body.monthlyHoursTarget,
        color: body.color || "cyan",
      })
      .returning();

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error("Failed to create goal:", error);
    return NextResponse.json(
      { error: "Failed to create goal" },
      { status: 500 }
    );
  }
}
