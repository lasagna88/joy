import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../lib/db";
import { tasks, calendarEvents } from "../../lib/db/schema";
import { and, eq, ne, gte, lt } from "drizzle-orm";
import { AI_TOOLS } from "../../lib/ai/tools";
import { handleToolCall } from "../../lib/ai/tool-handlers";
import { getSystemPrompt } from "../../lib/ai";
import { sendPushNotification } from "../../lib/notifications";

const MAX_ROUNDS = 10;

export async function runMorningBriefing(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];

  console.log(`[morning-briefing] Planning for ${dateStr}`);

  const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Good morning! It's ${dateStr}. Please plan my day:

1. Check my inbox tasks and any existing events for today.
2. Check my scheduling preferences and goals.
3. Clear any stale AI-planned events from today.
4. Create a full schedule for today following the scheduling rules.
5. Give me a morning briefing summary — what's the focus today, key appointments, and anything I should know.

Keep the summary brief and actionable.`;

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];
  let finalText = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      system: getSystemPrompt(),
      tools: AI_TOOLS,
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    if (textBlocks.length > 0) {
      finalText += textBlocks.map((b) => b.text).join("\n");
    }

    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await handleToolCall(
        block.name,
        block.input as Record<string, unknown>
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }

    messages = [
      ...messages,
      { role: "assistant" as const, content: response.content },
      { role: "user" as const, content: toolResults },
    ];
  }

  // Send push notification
  const briefBody = finalText.length > 200
    ? finalText.slice(0, 197) + "..."
    : finalText;

  await sendPushNotification({
    title: "Good Morning — Your Day is Planned",
    body: briefBody || "Your schedule is ready. Open Joy to see it.",
    url: "/",
    type: "morning_briefing",
  });

  console.log(`[morning-briefing] Done. Summary: ${finalText.slice(0, 100)}...`);
  return finalText;
}
