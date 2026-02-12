import { kimiPlan } from "../../lib/ai/kimi";
import { sendPushNotification } from "../../lib/notifications";

export async function runWeeklyPlan(): Promise<string> {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = monday.toISOString().split("T")[0];
  const weekEnd = sunday.toISOString().split("T")[0];

  console.log(`[weekly-plan] Planning week ${weekStart} to ${weekEnd}`);

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

  const { text: finalText } = await kimiPlan(prompt, 12);

  await sendPushNotification({
    title: "Weekly Plan Ready",
    body: finalText.length > 200 ? finalText.slice(0, 197) + "..." : finalText || "Your week is planned.",
    url: "/week",
    type: "weekly_plan",
  });

  console.log(`[weekly-plan] Done.`);
  return finalText;
}
