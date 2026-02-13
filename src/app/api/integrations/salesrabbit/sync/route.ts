import { NextRequest, NextResponse } from "next/server";
import { fullSync, isConnected, wipeAndReset } from "@/lib/salesrabbit";

/**
 * POST /api/integrations/salesrabbit/sync — Trigger a manual sync
 * ?wipe=true — wipe all existing data and re-sync
 * ?wipeOnly=true — wipe all existing data WITHOUT re-syncing
 */
export async function POST(request: NextRequest) {
  try {
    const connected = await isConnected();
    if (!connected) {
      return NextResponse.json(
        { error: "SalesRabbit not connected" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);

    // Wipe-only mode: delete all SR data without re-syncing
    if (searchParams.get("wipeOnly") === "true") {
      const wiped = await wipeAndReset();
      return NextResponse.json({ wiped, newTasks: 0, newAppointments: 0 });
    }

    let wiped = 0;
    if (searchParams.get("wipe") === "true") {
      wiped = await wipeAndReset();
    }

    const result = await fullSync();
    return NextResponse.json({ ...result, wiped });
  } catch (error) {
    console.error("[api/integrations/salesrabbit/sync] Sync error:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
