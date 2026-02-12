import { kimiPlan } from "../../lib/ai/kimi";
import { sendPushNotification } from "../../lib/notifications";

export async function runEveningReview(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  console.log(`[evening-review] Reviewing ${dateStr}, prepping ${tomorrowStr}`);

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

  const { text: finalText } = await kimiPlan(prompt, 8);

  await sendPushNotification({
    title: "Evening Review",
    body: finalText.length > 200 ? finalText.slice(0, 197) + "..." : finalText || "Review complete.",
    url: "/",
    type: "evening_review",
  });

  console.log(`[evening-review] Done.`);
  return finalText;
}
