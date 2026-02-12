import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient, SYSTEM_PROMPT } from "@/lib/ai";
import { AI_TOOLS } from "@/lib/ai/tools";
import { handleToolCall } from "@/lib/ai/tool-handlers";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_TOOL_ROUNDS = 10; // Planning needs more rounds

export async function POST(request: NextRequest) {
  try {
    const { date } = await request.json();

    const targetDate = date || new Date().toISOString().split("T")[0];

    const claude = getAnthropicClient();

    const planningPrompt = `Plan my day for ${targetDate}.

First, check what tasks are in my inbox and what events are already scheduled for that date. Then check my scheduling preferences and active goals.

Based on all that information, create a full day schedule by:
1. Clear any existing AI-planned events for that date (keep blockers)
2. Place fixed appointments first (if any exist as blocker events)
3. Schedule the main door knocking block
4. Add lunch break
5. Place follow-ups, admin work, and goal time in remaining slots
6. Add travel buffers around appointments with locations
7. Add transition buffers between different types of activities
8. Leave slack time

Create calendar events for each block using create_calendar_event. Mark scheduled tasks as "scheduled" using update_task.

Then give me a brief summary of the plan.`;

    let currentMessages: Anthropic.MessageParam[] = [
      { role: "user", content: planningPrompt },
    ];

    let finalText = "";
    const allToolActions: Array<{
      tool: string;
      input: Record<string, unknown>;
    }> = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await claude.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: AI_TOOLS,
        messages: currentMessages,
      });

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
        break;
      }

      // Execute tool calls
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
        });
      }

      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: toolResults },
      ];
    }

    return NextResponse.json({
      success: true,
      date: targetDate,
      summary: finalText,
      actions: allToolActions,
    });
  } catch (error) {
    console.error("Planning error:", error);
    return NextResponse.json(
      { error: "Failed to plan day" },
      { status: 500 }
    );
  }
}
