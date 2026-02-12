import Anthropic from "@anthropic-ai/sdk";
import { AI_TOOLS } from "../../lib/ai/tools";
import { handleToolCall } from "../../lib/ai/tool-handlers";
import { SYSTEM_PROMPT } from "../../lib/ai";
import { sendPushNotification } from "../../lib/notifications";

const MAX_ROUNDS = 8;

export async function runEveningReview(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  console.log(`[evening-review] Reviewing ${dateStr}, prepping ${tomorrowStr}`);

  const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Evening review time. Today is ${dateStr}.

1. Check today's events — what was completed vs what's still on the schedule?
2. Check for any incomplete tasks that should be moved to tomorrow.
3. Look at inbox for anything that came in today but wasn't scheduled.
4. Prepare a draft schedule for tomorrow (${tomorrowStr}).
5. Give me a brief evening summary:
   - What got done today
   - What's carrying over to tomorrow
   - Tomorrow's top priority

Keep it brief and motivating.`;

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];
  let finalText = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
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

  await sendPushNotification({
    title: "Evening Review",
    body: finalText.length > 200 ? finalText.slice(0, 197) + "..." : finalText || "Review complete.",
    url: "/",
    type: "evening_review",
  });

  console.log(`[evening-review] Done.`);
  return finalText;
}
