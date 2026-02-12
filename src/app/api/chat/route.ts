import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient, getSystemPrompt } from "@/lib/ai";
import { AI_TOOLS } from "@/lib/ai/tools";
import { handleToolCall } from "@/lib/ai/tool-handlers";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_TOOL_ROUNDS = 10;

export async function POST(request: NextRequest) {
  try {
    const { message, conversationId } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const claude = getAnthropicClient();

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

    // Build Claude messages from history
    const claudeMessages: Anthropic.MessageParam[] = [];
    for (const msg of history) {
      if (msg.role === "user") {
        claudeMessages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        claudeMessages.push({ role: "assistant", content: msg.content });
      } else if (msg.role === "tool_use" && msg.toolCalls) {
        // Reconstruct assistant message with tool use
        claudeMessages.push({
          role: "assistant",
          content: msg.toolCalls as Anthropic.ContentBlock[],
        });
      } else if (msg.role === "tool_result" && msg.toolResults) {
        claudeMessages.push({
          role: "user",
          content: msg.toolResults as Anthropic.ToolResultBlockParam[],
        });
      }
    }

    // Run the AI loop — Claude may call tools multiple times
    let finalText = "";
    let allToolActions: Array<{ tool: string; input: Record<string, unknown>; result: string }> = [];
    let currentMessages = claudeMessages;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await claude.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: getSystemPrompt(),
        tools: AI_TOOLS,
        messages: currentMessages,
      });

      // Check if Claude wants to use tools
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );

      if (textBlocks.length > 0) {
        finalText += textBlocks.map((b) => b.text).join("\n");
      }

      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        // No more tools — we're done
        break;
      }

      // Save the assistant's tool_use message for history reconstruction
      await db.insert(messages).values({
        conversationId: convId,
        role: "tool_use",
        content: "",
        toolCalls: response.content as unknown as Record<string, unknown>,
      });

      // Execute each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        const result = await handleToolCall(
          toolBlock.name,
          toolBlock.input as Record<string, unknown>
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        });
        allToolActions.push({
          tool: toolBlock.name,
          input: toolBlock.input as Record<string, unknown>,
          result,
        });
      }

      // Save tool results for history
      await db.insert(messages).values({
        conversationId: convId,
        role: "tool_result",
        content: "",
        toolResults: toolResults as unknown as Record<string, unknown>,
      });

      // Continue the conversation with tool results
      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: toolResults },
      ];
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
      toolActions: allToolActions,
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
