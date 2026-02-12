import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groceryItems } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const unchecked = await db
      .select()
      .from(groceryItems)
      .where(eq(groceryItems.checked, false))
      .orderBy(desc(groceryItems.createdAt));

    const checked = await db
      .select()
      .from(groceryItems)
      .where(eq(groceryItems.checked, true))
      .orderBy(desc(groceryItems.checkedAt));

    return NextResponse.json({ items: [...unchecked, ...checked] });
  } catch (error) {
    console.error("Failed to fetch grocery items:", error);
    return NextResponse.json({ items: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const [item] = await db
      .insert(groceryItems)
      .values({ name: body.name })
      .returning();

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error("Failed to create grocery item:", error);
    return NextResponse.json(
      { error: "Failed to create grocery item" },
      { status: 500 }
    );
  }
}
