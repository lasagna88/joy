import { NextRequest, NextResponse } from "next/server";
import {
  getAuthUrl,
  getConnectionStatus,
  disconnect,
  setWorkCalendarId,
} from "@/lib/google-calendar";

/**
 * GET /api/integrations/google — Get connection status
 */
export async function GET() {
  try {
    const status = await getConnectionStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[api/integrations/google] Status error:", error);
    return NextResponse.json(
      { error: "Failed to check status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/google — Start OAuth flow (returns auth URL)
 */
export async function POST() {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return NextResponse.json(
        { error: "Google OAuth credentials not configured" },
        { status: 500 }
      );
    }

    const authUrl = getAuthUrl();
    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("[api/integrations/google] Auth URL error:", error);
    return NextResponse.json(
      { error: "Failed to generate auth URL" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/integrations/google — Update Google Calendar config
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.workCalendarId !== undefined) {
      await setWorkCalendarId(body.workCalendarId || null);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/integrations/google] Config update error:", error);
    return NextResponse.json(
      { error: "Failed to update config" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/google — Disconnect Google Calendar
 */
export async function DELETE() {
  try {
    await disconnect();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/integrations/google] Disconnect error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }
}
