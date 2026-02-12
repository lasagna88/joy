import Anthropic from "@anthropic-ai/sdk";
import { AI_TOOLS } from "../../lib/ai/tools";
import { handleToolCall } from "../../lib/ai/tool-handlers";
import { SYSTEM_PROMPT } from "../../lib/ai";
import { sendPushNotification } from "../../lib/notifications";

const MAX_ROUNDS = 12;

export async function runWeeklyPlan(): Promise<string> {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = monday.toISOString().split("T")[0];
  const weekEnd = sunday.toISOString().split("T")[0];

  console.log(`[weekly-plan] Planning week ${weekStart} to ${weekEnd}`);

  const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Weekly planning session. Let's plan next week (${weekStart} to ${weekEnd}).

1. Check all current tasks (inbox and scheduled).
2. Check active goals and their weekly hour targets.
3. Check preferences for work hours.
4. Check if there are any existing events/blockers for next week.
5. For each day Monday through Friday:
   - Create a schedule following the scheduling rules
   - Ensure goal time is allocated across the week to meet targets
   - Place appointments and known commitments first
   - Fill door knocking blocks
   - Add admin and follow-up time

6. Give me a weekly overview:
   - How many hours allocated to each category
   - Goal progress targets for the week
   - Key appointments/commitments
   - Any conflicts or concerns

Keep the summary structured and clear.`;

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];
  let finalText = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
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
    title: "Weekly Plan Ready",
    body: finalText.length > 200 ? finalText.slice(0, 197) + "..." : finalText || "Your week is planned.",
    url: "/week",
    type: "weekly_plan",
  });

  console.log(`[weekly-plan] Done.`);
  return finalText;
}
