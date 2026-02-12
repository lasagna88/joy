import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { createToken, setTokenCookie, hashPassphrase } from "@/lib/auth";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { passphrase } = await request.json();

    if (!passphrase || typeof passphrase !== "string") {
      return NextResponse.json(
        { error: "Passphrase is required" },
        { status: 400 }
      );
    }

    // Get stored passphrase hash, or create one on first login
    const stored = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.key, "passphrase_hash"))
      .limit(1);

    if (stored.length === 0) {
      // First-time setup: hash and store the configured passphrase
      const configuredPassphrase = process.env.PASSPHRASE;
      if (!configuredPassphrase) {
        return NextResponse.json(
          { error: "Server passphrase not configured" },
          { status: 500 }
        );
      }

      const hashed = await hashPassphrase(configuredPassphrase);
      await db.insert(userPreferences).values({
        key: "passphrase_hash",
        value: hashed,
      });

      // Check against configured passphrase
      if (passphrase !== configuredPassphrase) {
        return NextResponse.json(
          { error: "Invalid passphrase" },
          { status: 401 }
        );
      }
    } else {
      // Verify against stored hash
      const storedHash = stored[0].value as string;
      const valid = await compare(passphrase, storedHash);
      if (!valid) {
        return NextResponse.json(
          { error: "Invalid passphrase" },
          { status: 401 }
        );
      }
    }

    const token = await createToken();
    await setTokenCookie(token);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
