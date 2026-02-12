import { GoogleGenAI } from "@google/genai";
import { toGeminiTools } from "./tools";
import { handleToolCall } from "./tool-handlers";
import { getSystemPrompt } from "./index";

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { functionCall: { id?: string; name: string; args: Record<string, unknown> } }
  | { functionResponse: { id?: string; name: string; response: Record<string, unknown> } };

const MAX_TOOL_ROUNDS = 10;

let client: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
  }
  return client;
}

export interface ChatResult {
  text: string;
  toolActions: Array<{ tool: string; input: Record<string, unknown>; result: string }>;
}

/**
 * Convert stored DB messages into Gemini's contents format.
 * DB messages have roles: "user", "assistant", "tool_use", "tool_result"
 */
export function dbMessagesToGeminiContents(
  history: Array<{ role: string; content: string; toolCalls?: unknown; toolResults?: unknown }>
): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const msg of history) {
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      contents.push({ role: "model", parts: [{ text: msg.content }] });
    } else if (msg.role === "tool_use" && msg.toolCalls) {
      // Reconstruct model message with function calls
      const calls = msg.toolCalls as Array<{ name: string; id?: string; args?: Record<string, unknown> }>;
      const parts: GeminiPart[] = calls.map((c) => ({
        functionCall: { id: c.id, name: c.name, args: c.args || {} },
      }));
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool_result" && msg.toolResults) {
      // Reconstruct user message with function responses
      const results = msg.toolResults as Array<{ name: string; id?: string; response: Record<string, unknown> }>;
      const parts: GeminiPart[] = results.map((r) => ({
        functionResponse: { id: r.id, name: r.name, response: r.response },
      }));
      contents.push({ role: "user", parts });
    }
  }

  return contents;
}

/**
 * Run a chat turn through Gemini 2.5 Flash with tool calling loop.
 */
export async function geminiChat(
  contents: GeminiContent[]
): Promise<ChatResult> {
  const ai = getGeminiClient();
  const tools = toGeminiTools();
  const systemInstruction = await getSystemPrompt();

  let finalText = "";
  const toolActions: ChatResult["toolActions"] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    console.log(`[gemini] Round ${round + 1}, ${contents.length} messages`);

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
        systemInstruction,
        maxOutputTokens: 1024,
      },
    });

    const functionCalls = result.functionCalls;

    // Extract text
    if (result.text) {
      finalText += result.text;
    }

    if (!functionCalls || functionCalls.length === 0) {
      break;
    }

    // Build the model's function call parts
    const modelParts: GeminiPart[] = [];
    if (result.text) {
      modelParts.push({ text: result.text });
    }
    for (const call of functionCalls) {
      modelParts.push({
        functionCall: { id: call.id, name: call.name!, args: call.args as Record<string, unknown> },
      });
    }
    contents.push({ role: "model", parts: modelParts });

    // Execute each tool and build function response parts
    const responseParts: GeminiPart[] = [];
    for (const call of functionCalls) {
      const toolResult = await handleToolCall(
        call.name!,
        (call.args as Record<string, unknown>) || {}
      );
      responseParts.push({
        functionResponse: {
          id: call.id,
          name: call.name!,
          response: { output: toolResult },
        },
      });
      toolActions.push({
        tool: call.name!,
        input: (call.args as Record<string, unknown>) || {},
        result: toolResult,
      });
    }
    contents.push({ role: "user", parts: responseParts });

    // Clear finalText for next round — we only want the final text response
    finalText = "";
  }

  console.log(`[gemini] Done. Text length: ${finalText.length}, tools used: ${toolActions.length}`);
  return { text: finalText, toolActions };
}
