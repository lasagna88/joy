import { NextResponse } from "next/server";
import { fullSync, isConnected } from "@/lib/salesrabbit";

/**
 * POST /api/integrations/salesrabbit/sync — Trigger a manual sync
 */
export async function POST() {
  try {
    const connected = await isConnected();
    if (!connected) {
      return NextResponse.json(
        { error: "SalesRabbit not connected" },
        { status: 400 }
      );
    }

    const result = await fullSync();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/integrations/salesrabbit/sync] Sync error:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
