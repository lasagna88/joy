import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { schedulingRules, goals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const result = await db
      .select({
        id: schedulingRules.id,
        text: schedulingRules.text,
        goalId: schedulingRules.goalId,
        isActive: schedulingRules.isActive,
        createdAt: schedulingRules.createdAt,
        goalTitle: goals.title,
      })
      .from(schedulingRules)
      .leftJoin(goals, eq(schedulingRules.goalId, goals.id))
      .where(eq(schedulingRules.isActive, true))
      .orderBy(schedulingRules.createdAt);

    return NextResponse.json({ rules: result });
  } catch (error) {
    console.error("Failed to fetch scheduling rules:", error);
    return NextResponse.json({ rules: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.text || typeof body.text !== "string") {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }

    const [rule] = await db
      .insert(schedulingRules)
      .values({
        text: body.text.trim(),
        goalId: body.goalId || null,
      })
      .returning();

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    console.error("Failed to create scheduling rule:", error);
    return NextResponse.json(
      { error: "Failed to create scheduling rule" },
      { status: 500 }
    );
  }
}
