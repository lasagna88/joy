import { NextRequest, NextResponse } from "next/server";
import { handleWebhook } from "@/lib/bigin";

/**
 * POST /api/integrations/bigin/webhook — Bigin webhook endpoint
 *
 * Optional: Configure in Zoho Bigin settings to receive real-time
 * notifications when deals or tasks change. Falls back gracefully
 * to the 15-minute polling sync if webhooks aren't set up.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    await handleWebhook(payload);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[bigin webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
