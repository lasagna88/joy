import { NextRequest, NextResponse } from "next/server";
import { handleWebhook } from "@/lib/salesrabbit";
import { Queue } from "bullmq";
import Redis from "ioredis";

/**
 * POST /api/integrations/salesrabbit/webhook — SalesRabbit webhook endpoint
 *
 * When a new appointment is detected, triggers an AI replan to
 * adjust the schedule around the fixed appointment anchor.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const result = await handleWebhook(payload);

    // If new appointments were found, trigger a replan
    if (result.needsReplan) {
      try {
        const connection = new Redis(
          process.env.REDIS_URL || "redis://localhost:6379",
          { maxRetriesPerRequest: null }
        );
        const planningQueue = new Queue("planning", { connection });
        await planningQueue.add("replan", {
          date: new Date().toISOString().split("T")[0],
          reason: "New SalesRabbit appointment",
        });
        await connection.quit();
      } catch (err) {
        console.error("[salesrabbit webhook] Failed to trigger replan:", err);
      }
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[salesrabbit webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
