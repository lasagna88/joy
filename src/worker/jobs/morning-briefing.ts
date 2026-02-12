import { kimiPlan } from "../../lib/ai/kimi";
import { sendPushNotification } from "../../lib/notifications";

export async function runMorningBriefing(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];

  console.log(`[morning-briefing] Planning for ${dateStr}`);

  const prompt = `Good morning! It's ${dateStr}. Please plan my day:

1. Check my inbox tasks and any existing events for today.
2. Check my scheduling preferences and goals.
3. Clear any stale AI-planned events from today.
4. Create a full schedule for today following the scheduling rules.
5. Give me a morning briefing summary — what's the focus today, key appointments, and anything I should know.

Keep the summary brief and actionable.`;

  const { text: finalText } = await kimiPlan(prompt, 10);

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
