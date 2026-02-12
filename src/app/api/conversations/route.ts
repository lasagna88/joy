import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { desc, eq, asc } from "drizzle-orm";

// GET /api/conversations — list conversations
export async function GET() {
  try {
    const convs = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(20);

    return NextResponse.json({ conversations: convs });
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    return NextResponse.json({ conversations: [] });
  }
}
