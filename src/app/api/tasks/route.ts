import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = db.select().from(tasks).orderBy(desc(tasks.createdAt)).$dynamic();

    if (status) {
      query = query.where(
        eq(tasks.status, status as "inbox" | "scheduled" | "in_progress" | "completed" | "cancelled")
      );
    }

    const result = await query;
    return NextResponse.json({ tasks: result });
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return NextResponse.json({ tasks: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const [task] = await db
      .insert(tasks)
      .values({
        title: body.title,
        description: body.description,
        priority: body.priority || "medium",
        category: body.category || "other",
        estimatedMinutes: body.estimatedMinutes,
        deadline: body.deadline ? new Date(body.deadline) : undefined,
        location: body.location,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
      })
      .returning();

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Failed to create task:", error);
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 }
    );
  }
}
