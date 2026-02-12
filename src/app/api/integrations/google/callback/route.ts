import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, fullSync } from "@/lib/google-calendar";

/**
 * GET /api/integrations/google/callback — OAuth callback handler
 * Google redirects here after user grants permission.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (error) {
    console.error("[gcal callback] OAuth error:", error);
    return NextResponse.redirect(
      `${appUrl}/settings?gcal=error&reason=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/settings?gcal=error&reason=no_code`
    );
  }

  try {
    await exchangeCodeForTokens(code);

    // Run initial sync in the background
    fullSync().catch((err) =>
      console.error("[gcal callback] Initial sync failed:", err)
    );

    return NextResponse.redirect(`${appUrl}/settings?gcal=connected`);
  } catch (err) {
    console.error("[gcal callback] Token exchange failed:", err);
    return NextResponse.redirect(
      `${appUrl}/settings?gcal=error&reason=token_exchange_failed`
    );
  }
}
