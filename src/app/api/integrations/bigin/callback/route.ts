import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, fullSync } from "@/lib/bigin";

/**
 * GET /api/integrations/bigin/callback — Zoho OAuth callback
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (error) {
    console.error("[bigin callback] OAuth error:", error);
    return NextResponse.redirect(
      `${appUrl}/settings?bigin=error&reason=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/settings?bigin=error&reason=no_code`
    );
  }

  try {
    await exchangeCodeForTokens(code);

    // Run initial sync in the background
    fullSync().catch((err) =>
      console.error("[bigin callback] Initial sync failed:", err)
    );

    return NextResponse.redirect(`${appUrl}/settings?bigin=connected`);
  } catch (err) {
    console.error("[bigin callback] Token exchange failed:", err);
    return NextResponse.redirect(
      `${appUrl}/settings?bigin=error&reason=token_exchange_failed`
    );
  }
}
