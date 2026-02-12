import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groceryItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const [item] = await db
      .update(groceryItems)
      .set({
        checked: body.checked,
        checkedAt: body.checked ? new Date() : null,
      })
      .where(eq(groceryItems.id, id))
      .returning();

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (error) {
    console.error("Failed to update grocery item:", error);
    return NextResponse.json(
      { error: "Failed to update grocery item" },
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

    const [deleted] = await db
      .delete(groceryItems)
      .where(eq(groceryItems.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete grocery item:", error);
    return NextResponse.json(
      { error: "Failed to delete grocery item" },
      { status: 500 }
    );
  }
}
