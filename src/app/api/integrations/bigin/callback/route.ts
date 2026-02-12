import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, fullSync } from "@/lib/bigin";

/**
 * GET /api/integrations/bigin/callback — Zoho OAuth callback
 *
 * Zoho sends back: ?code=XXX&location=us&accounts-server=https://accounts.zoho.com
 * We must use the accounts-server URL for the token exchange (data center matters).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const accountsServer = searchParams.get("accounts-server");

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
    await exchangeCodeForTokens(code, accountsServer || undefined);

    // Run initial sync in the background
    fullSync().catch((err) =>
      console.error("[bigin callback] Initial sync failed:", err)
    );

    return NextResponse.redirect(`${appUrl}/settings?bigin=connected`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[bigin callback] Token exchange failed:", msg);
    return NextResponse.redirect(
      `${appUrl}/settings?bigin=error&reason=${encodeURIComponent(msg)}`
    );
  }
}
