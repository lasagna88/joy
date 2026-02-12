import { NextRequest, NextResponse } from "next/server";
import { geminiChat, dbMessagesToGeminiContents } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { message, conversationId } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const [conv] = await db
        .insert(conversations)
        .values({ title: message.slice(0, 100) })
        .returning();
      convId = conv.id;
    }

    // Save user message
    await db.insert(messages).values({
      conversationId: convId,
      role: "user",
      content: message,
    });

    // Load conversation history (last 40 messages for context)
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(asc(messages.createdAt))
      .limit(40);

    // Convert DB history to Gemini format
    const contents = dbMessagesToGeminiContents(history);

    // Run through Gemini with tool loop
    const { text: finalText, toolActions } = await geminiChat(contents);

    // Save tool_use / tool_result pairs for history reconstruction
    if (toolActions.length > 0) {
      // Save function calls
      await db.insert(messages).values({
        conversationId: convId,
        role: "tool_use",
        content: "",
        toolCalls: toolActions.map((a, i) => ({
          id: `tc_${i}`,
          name: a.tool,
          args: a.input,
        })) as unknown as Record<string, unknown>,
      });

      // Save function responses
      await db.insert(messages).values({
        conversationId: convId,
        role: "tool_result",
        content: "",
        toolResults: toolActions.map((a, i) => ({
          id: `tc_${i}`,
          name: a.tool,
          response: { output: a.result },
        })) as unknown as Record<string, unknown>,
      });
    }

    // Save the final assistant text response
    if (finalText) {
      await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content: finalText,
      });
    }

    return NextResponse.json({
      conversationId: convId,
      message: finalText,
      toolActions,
    });
  } catch (error) {
    console.error("Chat error:", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to process message", detail },
      { status: 500 }
    );
  }
}
