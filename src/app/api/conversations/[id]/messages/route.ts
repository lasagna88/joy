import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    // Filter to user and assistant text messages for the UI
    const chatMessages = msgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.content.length > 0);

    return NextResponse.json({ messages: chatMessages });
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    return NextResponse.json({ messages: [] });
  }
}
