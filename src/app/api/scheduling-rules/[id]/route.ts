import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { schedulingRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.text !== undefined) updates.text = body.text;
    if (body.goalId !== undefined) updates.goalId = body.goalId || null;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    const [rule] = await db
      .update(schedulingRules)
      .set(updates)
      .where(eq(schedulingRules.id, id))
      .returning();

    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    return NextResponse.json({ rule });
  } catch (error) {
    console.error("Failed to update scheduling rule:", error);
    return NextResponse.json(
      { error: "Failed to update scheduling rule" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [rule] = await db
      .delete(schedulingRules)
      .where(eq(schedulingRules.id, id))
      .returning();

    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete scheduling rule:", error);
    return NextResponse.json(
      { error: "Failed to delete scheduling rule" },
      { status: 500 }
    );
  }
}
