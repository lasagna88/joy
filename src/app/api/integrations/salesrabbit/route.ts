import { NextRequest, NextResponse } from "next/server";
import {
  connect,
  getConnectionStatus,
  disconnect,
  fullSync,
  getCallbackTriggerConfig,
  setCallbackTriggerConfig,
} from "@/lib/salesrabbit";

/**
 * GET /api/integrations/salesrabbit — Get connection status + callback config
 */
export async function GET() {
  try {
    const status = await getConnectionStatus();
    const callbackConfig = await getCallbackTriggerConfig();
    return NextResponse.json({ ...status, callbackConfig });
  } catch (error) {
    console.error("[api/integrations/salesrabbit] Status error:", error);
    return NextResponse.json(
      { error: "Failed to check status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/salesrabbit — Connect with API token
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiToken } = body;

    if (!apiToken || typeof apiToken !== "string") {
      return NextResponse.json(
        { error: "API token is required" },
        { status: 400 }
      );
    }

    const success = await connect(apiToken.trim());

    if (!success) {
      return NextResponse.json(
        { error: "Invalid API token. Could not authenticate with SalesRabbit." },
        { status: 401 }
      );
    }

    // Run initial sync in the background
    fullSync().catch((err) =>
      console.error("[salesrabbit] Initial sync failed:", err)
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/integrations/salesrabbit] Connect error:", error);
    return NextResponse.json(
      { error: "Failed to connect" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/integrations/salesrabbit — Update callback trigger config
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { callbackConfig } = body;

    if (!callbackConfig || typeof callbackConfig !== "object") {
      return NextResponse.json(
        { error: "callbackConfig object is required" },
        { status: 400 }
      );
    }

    const updated = await setCallbackTriggerConfig(callbackConfig);
    return NextResponse.json({ callbackConfig: updated });
  } catch (error) {
    console.error("[api/integrations/salesrabbit] Config update error:", error);
    return NextResponse.json(
      { error: "Failed to update config" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/salesrabbit — Disconnect
 */
export async function DELETE() {
  try {
    await disconnect();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/integrations/salesrabbit] Disconnect error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }
}
