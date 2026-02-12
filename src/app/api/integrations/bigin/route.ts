import { NextResponse } from "next/server";
import {
  getAuthUrl,
  getConnectionStatus,
  disconnect,
} from "@/lib/bigin";

/**
 * GET /api/integrations/bigin — Get connection status
 */
export async function GET() {
  try {
    const status = await getConnectionStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[api/integrations/bigin] Status error:", error);
    return NextResponse.json(
      { error: "Failed to check status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/bigin — Start OAuth flow (returns auth URL)
 */
export async function POST() {
  try {
    if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
      return NextResponse.json(
        { error: "Zoho OAuth credentials not configured" },
        { status: 500 }
      );
    }

    const authUrl = getAuthUrl();
    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("[api/integrations/bigin] Auth URL error:", error);
    return NextResponse.json(
      { error: "Failed to generate auth URL" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/bigin — Disconnect Bigin
 */
export async function DELETE() {
  try {
    await disconnect();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/integrations/bigin] Disconnect error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }
}
