import { NextRequest, NextResponse } from "next/server";
import { kimiPlan } from "@/lib/ai/kimi";

export async function POST(request: NextRequest) {
  try {
    const { date } = await request.json();

    const targetDate = date || new Date().toISOString().split("T")[0];

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

    const { text, toolActions } = await kimiPlan(planningPrompt);

    return NextResponse.json({
      success: true,
      date: targetDate,
      summary: text,
      actions: toolActions,
    });
  } catch (error) {
    console.error("Planning error:", error);
    return NextResponse.json(
      { error: "Failed to plan day" },
      { status: 500 }
    );
  }
}
