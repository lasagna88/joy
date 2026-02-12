import { google, calendar_v3 } from "googleapis";
import { db } from "@/lib/db";
import { integrationState, calendarEvents } from "@/lib/db/schema";
import { eq, and, gte, lt, isNotNull } from "drizzle-orm";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate the Google OAuth consent URL
 */
export function getAuthUrl(): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

/**
 * Exchange an authorization code for tokens, then store them
 */
export async function exchangeCodeForTokens(code: string) {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);

  await db
    .insert(integrationState)
    .values({
      provider: "google",
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || null,
      tokenExpiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : null,
      isActive: true,
      config: { calendarId: "primary" },
      lastSyncAt: null,
    })
    .onConflictDoUpdate({
      target: integrationState.provider,
      set: {
        accessToken: tokens.access_token || null,
        refreshToken: tokens.refresh_token || null,
        tokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : null,
        isActive: true,
        config: { calendarId: "primary" },
        updatedAt: new Date(),
      },
    });

  return tokens;
}

/**
 * Get an authenticated Google Calendar client, refreshing tokens if needed
 */
async function getCalendarClient(): Promise<calendar_v3.Calendar | null> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(
      and(
        eq(integrationState.provider, "google"),
        eq(integrationState.isActive, true)
      )
    );

  if (!state?.accessToken) return null;

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: state.accessToken,
    refresh_token: state.refreshToken,
    expiry_date: state.tokenExpiresAt?.getTime(),
  });

  // Refresh if expired or about to expire (5 min buffer)
  const expiresAt = state.tokenExpiresAt?.getTime() || 0;
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      await db
        .update(integrationState)
        .set({
          accessToken: credentials.access_token || state.accessToken,
          tokenExpiresAt: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : state.tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(integrationState.provider, "google"));

      oauth2.setCredentials(credentials);
    } catch (err) {
      console.error("[gcal] Token refresh failed:", err);
      // Mark as inactive if refresh fails
      await db
        .update(integrationState)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(integrationState.provider, "google"));
      return null;
    }
  }

  return google.calendar({ version: "v3", auth: oauth2 });
}

/**
 * Check if Google Calendar is connected and active
 */
export async function isConnected(): Promise<boolean> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(
      and(
        eq(integrationState.provider, "google"),
        eq(integrationState.isActive, true)
      )
    );
  return !!state;
}

/**
 * Get connection status details
 */
export async function getConnectionStatus() {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "google"));

  if (!state) return { connected: false };

  return {
    connected: state.isActive,
    lastSyncAt: state.lastSyncAt,
    tokenExpiresAt: state.tokenExpiresAt,
  };
}

/**
 * Disconnect Google Calendar (revoke + remove tokens)
 */
export async function disconnect() {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "google"));

  if (state?.accessToken) {
    try {
      const oauth2 = getOAuth2Client();
      await oauth2.revokeToken(state.accessToken);
    } catch {
      // Token may already be invalid, that's fine
    }
  }

  await db
    .update(integrationState)
    .set({
      isActive: false,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      syncCursor: null,
      updatedAt: new Date(),
    })
    .where(eq(integrationState.provider, "google"));
}

/**
 * Push a single Joy event to Google Calendar. Returns the Google event ID.
 */
export async function pushEventToGoogle(event: {
  id: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
}): Promise<string | null> {
  const cal = await getCalendarClient();
  if (!cal) return null;

  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "google"));

  const calendarId =
    (state?.config as Record<string, string>)?.calendarId || "primary";

  try {
    const res = await cal.events.insert({
      calendarId,
      requestBody: {
        summary: event.title,
        description: event.description || undefined,
        location: event.location || undefined,
        start: {
          dateTime: event.startTime.toISOString(),
        },
        end: {
          dateTime: event.endTime.toISOString(),
        },
        extendedProperties: {
          private: {
            joyEventId: event.id,
          },
        },
      },
    });

    const googleEventId = res.data.id;

    if (googleEventId) {
      // Store the Google event ID on our event
      await db
        .update(calendarEvents)
        .set({ googleEventId, updatedAt: new Date() })
        .where(eq(calendarEvents.id, event.id));
    }

    return googleEventId || null;
  } catch (err) {
    console.error("[gcal] Failed to push event:", err);
    return null;
  }
}

/**
 * Update an existing Google Calendar event
 */
export async function updateGoogleEvent(event: {
  id: string;
  googleEventId: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
}): Promise<boolean> {
  const cal = await getCalendarClient();
  if (!cal) return false;

  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "google"));

  const calendarId =
    (state?.config as Record<string, string>)?.calendarId || "primary";

  try {
    await cal.events.update({
      calendarId,
      eventId: event.googleEventId,
      requestBody: {
        summary: event.title,
        description: event.description || undefined,
        location: event.location || undefined,
        start: {
          dateTime: event.startTime.toISOString(),
        },
        end: {
          dateTime: event.endTime.toISOString(),
        },
      },
    });
    return true;
  } catch (err) {
    console.error("[gcal] Failed to update event:", err);
    return false;
  }
}

/**
 * Delete a Google Calendar event
 */
export async function deleteGoogleEvent(
  googleEventId: string
): Promise<boolean> {
  const cal = await getCalendarClient();
  if (!cal) return false;

  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "google"));

  const calendarId =
    (state?.config as Record<string, string>)?.calendarId || "primary";

  try {
    await cal.events.delete({
      calendarId,
      eventId: googleEventId,
    });
    return true;
  } catch (err) {
    console.error("[gcal] Failed to delete event:", err);
    return false;
  }
}

/**
 * Pull external events from Google Calendar and create blocker events in Joy.
 * Only pulls events not created by Joy (no joyEventId in extended properties).
 */
export async function pullExternalEvents(
  startDate: Date,
  endDate: Date
): Promise<number> {
  const cal = await getCalendarClient();
  if (!cal) return 0;

  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "google"));

  const calendarId =
    (state?.config as Record<string, string>)?.calendarId || "primary";

  try {
    const res = await cal.events.list({
      calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100,
    });

    const googleEvents = res.data.items || [];
    let imported = 0;

    for (const gEvent of googleEvents) {
      // Skip events created by Joy
      if (gEvent.extendedProperties?.private?.joyEventId) continue;

      // Skip all-day events (no dateTime)
      if (!gEvent.start?.dateTime || !gEvent.end?.dateTime) continue;

      // Skip cancelled events
      if (gEvent.status === "cancelled") continue;

      const googleEventId = gEvent.id;
      if (!googleEventId) continue;

      // Check if we already have this event
      const [existing] = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.googleEventId, googleEventId));

      if (existing) {
        // Update if changed
        const startTime = new Date(gEvent.start.dateTime);
        const endTime = new Date(gEvent.end.dateTime);
        const changed =
          existing.title !== (gEvent.summary || "Busy") ||
          existing.startTime.getTime() !== startTime.getTime() ||
          existing.endTime.getTime() !== endTime.getTime() ||
          existing.location !== (gEvent.location || null);

        if (changed) {
          await db
            .update(calendarEvents)
            .set({
              title: gEvent.summary || "Busy",
              startTime,
              endTime,
              location: gEvent.location || null,
              description: gEvent.description || null,
              updatedAt: new Date(),
            })
            .where(eq(calendarEvents.id, existing.id));
        }
      } else {
        // Create new blocker event
        await db.insert(calendarEvents).values({
          title: gEvent.summary || "Busy",
          description: gEvent.description || null,
          startTime: new Date(gEvent.start.dateTime),
          endTime: new Date(gEvent.end.dateTime),
          location: gEvent.location || null,
          source: "google_calendar",
          googleEventId,
          isBlocker: true,
          color: "slate",
          metadata: {
            category: "other",
            googleCalendar: true,
          },
        });
        imported++;
      }
    }

    // Remove Joy blocker events that no longer exist in Google Calendar
    const googleEventIds = googleEvents
      .filter((e) => e.id && !e.extendedProperties?.private?.joyEventId)
      .map((e) => e.id!);

    const joyBlockers = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.source, "google_calendar"),
          gte(calendarEvents.startTime, startDate),
          lt(calendarEvents.startTime, endDate),
          isNotNull(calendarEvents.googleEventId)
        )
      );

    for (const blocker of joyBlockers) {
      if (blocker.googleEventId && !googleEventIds.includes(blocker.googleEventId)) {
        await db
          .delete(calendarEvents)
          .where(eq(calendarEvents.id, blocker.id));
      }
    }

    return imported;
  } catch (err) {
    console.error("[gcal] Failed to pull events:", err);
    return 0;
  }
}

/**
 * Full sync: push all Joy AI-planned events to Google, pull external events as blockers.
 * Covers today + next 7 days.
 */
export async function fullSync(): Promise<{
  pushed: number;
  pulled: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let pushed = 0;
  let pulled = 0;

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(startDate.getTime() + 8 * 24 * 60 * 60 * 1000); // 8 days ahead

  // 1. Push Joy events that don't have a Google ID yet
  const unpushedEvents = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.source, "ai_planned"),
        gte(calendarEvents.startTime, startDate),
        lt(calendarEvents.startTime, endDate)
      )
    );

  for (const event of unpushedEvents) {
    if (!event.googleEventId) {
      const gId = await pushEventToGoogle({
        id: event.id,
        title: event.title,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location,
      });
      if (gId) {
        pushed++;
      } else {
        errors.push(`Failed to push: ${event.title}`);
      }
    }
  }

  // 2. Pull external events as blockers
  try {
    pulled = await pullExternalEvents(startDate, endDate);
  } catch (err) {
    errors.push(`Pull failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }

  // 3. Update last sync timestamp
  await db
    .update(integrationState)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(integrationState.provider, "google"));

  console.log(
    `[gcal] Sync complete: ${pushed} pushed, ${pulled} pulled, ${errors.length} errors`
  );

  return { pushed, pulled, errors };
}
