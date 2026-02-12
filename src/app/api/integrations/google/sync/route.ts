import { NextResponse } from "next/server";
import { fullSync, isConnected } from "@/lib/google-calendar";

/**
 * POST /api/integrations/google/sync — Trigger a manual sync
 */
export async function POST() {
  try {
    const connected = await isConnected();
    if (!connected) {
      return NextResponse.json(
        { error: "Google Calendar not connected" },
        { status: 400 }
      );
    }

    const result = await fullSync();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/integrations/google/sync] Sync error:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
