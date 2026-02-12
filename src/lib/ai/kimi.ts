import OpenAI from "openai";
import { toOpenAITools } from "./tools";
import { handleToolCall } from "./tool-handlers";
import { getSystemPrompt } from "./index";

let client: OpenAI | null = null;

function getKimiClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: "https://api.moonshot.ai/v1",
    });
  }
  return client;
}

export interface PlanResult {
  text: string;
  toolActions: Array<{ tool: string; input: Record<string, unknown>; result: string }>;
}

/**
 * Run a planning prompt through Kimi K2.5 with tool calling loop.
 */
export async function kimiPlan(
  prompt: string,
  maxRounds = 12
): Promise<PlanResult> {
  const kimi = getKimiClient();
  const tools = toOpenAITools();
  const systemPrompt = await getSystemPrompt();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  let finalText = "";
  const toolActions: PlanResult["toolActions"] = [];

  for (let round = 0; round < maxRounds; round++) {
    console.log(`[kimi] Round ${round + 1}, ${messages.length} messages`);

    const response = await kimi.chat.completions.create({
      model: "kimi-k2.5",
      messages,
      tools,
      max_tokens: 4096,
    });

    const choice = response.choices[0];
    const assistantMsg = choice.message;

    // Append the assistant message to history
    messages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls;

    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
      finalText = assistantMsg.content || "";
      break;
    }

    // Execute each tool call and append results
    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      const result = await handleToolCall(tc.function.name, args);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });

      toolActions.push({
        tool: tc.function.name,
        input: args,
        result,
      });
    }
  }

  console.log(`[kimi] Done. Text length: ${finalText.length}, tools used: ${toolActions.length}`);
  return { text: finalText, toolActions };
}
