import { google, calendar_v3 } from "googleapis";
import { db } from "@/lib/db";
import { integrationState, calendarEvents } from "@/lib/db/schema";
import { eq, and, gte, lt, isNotNull } from "drizzle-orm";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const WORK_CATEGORIES = new Set([
  "door_knocking",
  "appointment",
  "follow_up",
  "admin",
  "goal_work",
  "lunch",
  "travel",
  "buffer",
]);

const PERSONAL_CATEGORIES = new Set([
  "personal",
  "exercise",
  "errands",
  "partner_time",
  "meal_prep",
  "cleaning",
]);

export type CalendarType = "work" | "personal";

/**
 * Determine which Joy calendar an event belongs to based on its category.
 */
export function getCategoryCalendarType(category: string): CalendarType {
  if (PERSONAL_CATEGORIES.has(category)) return "personal";
  if (WORK_CATEGORIES.has(category)) return "work";
  return "work"; // default work
}

interface GoogleConfig {
  joyCalendarId?: string;
  joyWorkCalendarId?: string;
  joyPersonalCalendarId?: string;
  workCalendarId?: string;
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getGoogleConfig(): Promise<GoogleConfig> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "google"));

  return (state?.config as GoogleConfig) || {};
}

/**
 * Get the Joy calendar ID for a given type. Falls back to legacy joyCalendarId or "primary".
 */
async function getJoyCalendarId(type?: CalendarType): Promise<string> {
  const config = await getGoogleConfig();

  if (type === "work" && config.joyWorkCalendarId) return config.joyWorkCalendarId;
  if (type === "personal" && config.joyPersonalCalendarId) return config.joyPersonalCalendarId;

  // Backwards compat: fall back to single calendar
  return config.joyCalendarId || "primary";
}

/**
 * Get both Joy calendar IDs (for operations that need to check both).
 */
async function getJoyCalendarIds(): Promise<string[]> {
  const config = await getGoogleConfig();
  const ids: string[] = [];

  if (config.joyWorkCalendarId) ids.push(config.joyWorkCalendarId);
  if (config.joyPersonalCalendarId) ids.push(config.joyPersonalCalendarId);

  // Backwards compat: include legacy single calendar if no dual calendars
  if (ids.length === 0 && config.joyCalendarId) {
    ids.push(config.joyCalendarId);
  }

  return ids.length > 0 ? ids : ["primary"];
}

/**
 * Share a calendar with another email (reader access). Non-fatal on error.
 */
async function shareCalendar(
  cal: calendar_v3.Calendar,
  calendarId: string,
  email: string
) {
  try {
    await cal.acl.insert({
      calendarId,
      requestBody: {
        role: "reader",
        scope: { type: "user", value: email },
      },
    });
    console.log(`[gcal] Shared ${calendarId} with ${email}`);
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 409) {
      // Already shared
      return;
    }
    console.error(`[gcal] Failed to share calendar with ${email}:`, err);
  }
}

/**
 * Find or create a named Joy calendar with a specific color.
 */
async function findOrCreateCalendar(
  cal: calendar_v3.Calendar,
  calendarList: calendar_v3.Schema$CalendarListEntry[],
  summary: string,
  description: string,
  colorId: string
): Promise<string> {
  const existing = calendarList.find(
    (c) => c.summary === summary && c.accessRole === "owner"
  );
  if (existing?.id) return existing.id;

  const createRes = await cal.calendars.insert({
    requestBody: {
      summary,
      description,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });

  const newId = createRes.data.id!;

  await cal.calendarList.update({
    calendarId: newId,
    requestBody: { colorId },
  });

  return newId;
}

/**
 * Create or find both Joy Work and Joy Personal calendars.
 * Auto-shares both with the work email. Handles migration from legacy single "Joy" calendar.
 */
async function createOrFindJoyCalendars(
  cal: calendar_v3.Calendar
): Promise<{ joyWorkCalendarId: string; joyPersonalCalendarId: string }> {
  const listRes = await cal.calendarList.list();
  const calendars = listRes.data.items || [];

  const joyWorkCalendarId = await findOrCreateCalendar(
    cal,
    calendars,
    "Joy Work",
    "Work events planned by Joy AI",
    "9" // bold blue
  );

  const joyPersonalCalendarId = await findOrCreateCalendar(
    cal,
    calendars,
    "Joy Personal",
    "Personal events planned by Joy AI",
    "6" // flamingo/orange
  );

  // Share both with work account
  const shareEmail = "scottc@aurumsolar.ca";
  await shareCalendar(cal, joyWorkCalendarId, shareEmail);
  await shareCalendar(cal, joyPersonalCalendarId, shareEmail);

  return { joyWorkCalendarId, joyPersonalCalendarId };
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

  // Preserve existing config (e.g. workCalendarId) on reconnect
  const existingConfig = await getGoogleConfig();

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
      config: existingConfig,
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
        updatedAt: new Date(),
      },
    });

  // Create or find the dual Joy calendars
  try {
    const authClient = getOAuth2Client();
    authClient.setCredentials(tokens);
    const cal = google.calendar({ version: "v3", auth: authClient });
    const { joyWorkCalendarId, joyPersonalCalendarId } =
      await createOrFindJoyCalendars(cal);

    await db
      .update(integrationState)
      .set({
        config: {
          ...existingConfig,
          joyWorkCalendarId,
          joyPersonalCalendarId,
        },
        updatedAt: new Date(),
      })
      .where(eq(integrationState.provider, "google"));

    console.log(
      "[gcal] Joy calendars ready — Work:",
      joyWorkCalendarId,
      "Personal:",
      joyPersonalCalendarId
    );
  } catch (err) {
    console.error("[gcal] Failed to create Joy calendars:", err);
  }

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

  const config = (state.config as GoogleConfig) || {};

  return {
    connected: state.isActive,
    lastSyncAt: state.lastSyncAt,
    tokenExpiresAt: state.tokenExpiresAt,
    workCalendarId: config.workCalendarId || null,
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
 * Update the work calendar ID in integration config
 */
export async function setWorkCalendarId(workCalendarId: string | null) {
  const config = await getGoogleConfig();
  await db
    .update(integrationState)
    .set({
      config: { ...config, workCalendarId: workCalendarId || undefined },
      updatedAt: new Date(),
    })
    .where(eq(integrationState.provider, "google"));
}

/**
 * Push a single Joy event to Google Calendar. Returns the Google event ID.
 * Routes to Joy Work or Joy Personal calendar based on calendarType.
 */
export async function pushEventToGoogle(event: {
  id: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  calendarType?: CalendarType;
}): Promise<string | null> {
  const cal = await getCalendarClient();
  if (!cal) return null;

  const calendarId = await getJoyCalendarId(event.calendarType);

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
            calendarType: event.calendarType || "work",
          },
        },
      },
    });

    const googleEventId = res.data.id;

    if (googleEventId) {
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
 * Update an existing Google Calendar event.
 * Tries the matching calendar type first, falls back to all Joy calendars.
 */
export async function updateGoogleEvent(event: {
  id: string;
  googleEventId: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  calendarType?: CalendarType;
}): Promise<boolean> {
  const cal = await getCalendarClient();
  if (!cal) return false;

  const calendarIds = event.calendarType
    ? [await getJoyCalendarId(event.calendarType)]
    : await getJoyCalendarIds();

  for (const calendarId of calendarIds) {
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
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 404 && calendarIds.length > 1) continue;
      console.error("[gcal] Failed to update event:", err);
      return false;
    }
  }

  return false;
}

/**
 * Delete a Google Calendar event. Tries all Joy calendars.
 */
export async function deleteGoogleEvent(
  googleEventId: string,
  calendarType?: CalendarType
): Promise<boolean> {
  const cal = await getCalendarClient();
  if (!cal) return false;

  const calendarIds = calendarType
    ? [await getJoyCalendarId(calendarType)]
    : await getJoyCalendarIds();

  for (const calendarId of calendarIds) {
    try {
      await cal.events.delete({
        calendarId,
        eventId: googleEventId,
      });
      return true;
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 404 && calendarIds.length > 1) continue;
      if (code === 404 || code === 410) return true; // already gone
      console.error("[gcal] Failed to delete event:", err);
      return false;
    }
  }

  return false;
}

/**
 * Pull external events from one or more Google Calendars and create blocker events in Joy.
 * Pulls from primary calendar + configured work calendar.
 */
export async function pullExternalEvents(
  startDate: Date,
  endDate: Date
): Promise<number> {
  const cal = await getCalendarClient();
  if (!cal) return 0;

  const config = await getGoogleConfig();

  // Pull from primary + work calendar if configured
  const pullCalendarIds: string[] = ["primary"];
  if (config.workCalendarId) {
    pullCalendarIds.push(config.workCalendarId);
  }

  let imported = 0;
  const allGoogleEventIds: string[] = [];

  for (const calendarId of pullCalendarIds) {
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

      for (const gEvent of googleEvents) {
        // Skip events created by Joy
        if (gEvent.extendedProperties?.private?.joyEventId) continue;

        // Skip all-day events (no dateTime)
        if (!gEvent.start?.dateTime || !gEvent.end?.dateTime) continue;

        // Skip cancelled events
        if (gEvent.status === "cancelled") continue;

        const googleEventId = gEvent.id;
        if (!googleEventId) continue;

        allGoogleEventIds.push(googleEventId);

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
          const sourceLabel = calendarId === "primary" ? "personal" : "work";
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
              sourceCalendar: sourceLabel,
            },
          });
          imported++;
        }
      }
    } catch (err) {
      console.error(`[gcal] Failed to pull events from ${calendarId}:`, err);
    }
  }

  // Remove Joy blocker events that no longer exist in any source calendar
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
    if (blocker.googleEventId && !allGoogleEventIds.includes(blocker.googleEventId)) {
      await db
        .delete(calendarEvents)
        .where(eq(calendarEvents.id, blocker.id));
    }
  }

  return imported;
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

  const config = await getGoogleConfig();
  const hasDualCalendars = !!(config.joyWorkCalendarId && config.joyPersonalCalendarId);

  // Lazy migration: create dual calendars if not yet configured
  if (!hasDualCalendars) {
    try {
      const cal = await getCalendarClient();
      if (cal) {
        const { joyWorkCalendarId, joyPersonalCalendarId } =
          await createOrFindJoyCalendars(cal);
        await db
          .update(integrationState)
          .set({
            config: {
              ...config,
              joyWorkCalendarId,
              joyPersonalCalendarId,
            },
            updatedAt: new Date(),
          })
          .where(eq(integrationState.provider, "google"));
        console.log(
          "[gcal] Lazy migration: dual Joy calendars created — Work:",
          joyWorkCalendarId,
          "Personal:",
          joyPersonalCalendarId
        );
      }
    } catch (err) {
      errors.push(
        `Joy calendar creation failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(startDate.getTime() + 8 * 24 * 60 * 60 * 1000);

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
      const metadata = event.metadata as Record<string, unknown> | null;
      const category = (metadata?.category as string) || "other";
      const calendarType = (metadata?.calendarType as CalendarType) || getCategoryCalendarType(category);

      const gId = await pushEventToGoogle({
        id: event.id,
        title: event.title,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location,
        calendarType,
      });
      if (gId) {
        pushed++;
      } else {
        errors.push(`Failed to push: ${event.title}`);
      }
    }
  }

  // 2. Clean up Joy events that were deleted from Google Calendar
  const pushedEvents = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.source, "ai_planned"),
        isNotNull(calendarEvents.googleEventId),
        gte(calendarEvents.startTime, startDate),
        lt(calendarEvents.startTime, endDate)
      )
    );

  const cal = await getCalendarClient();
  const joyCalIds = await getJoyCalendarIds();
  if (cal) {
    for (const event of pushedEvents) {
      let found = false;
      for (const calId of joyCalIds) {
        try {
          await cal.events.get({
            calendarId: calId,
            eventId: event.googleEventId!,
          });
          found = true;
          break;
        } catch (err: unknown) {
          const status = (err as { code?: number }).code;
          if (status === 404 || status === 410) continue;
          found = true; // assume exists on API error
          break;
        }
      }
      if (!found) {
        await db
          .delete(calendarEvents)
          .where(eq(calendarEvents.id, event.id));
        console.log(`[gcal] Removed locally deleted event: ${event.title}`);
      }
    }
  }

  // 3. Pull external events as blockers
  try {
    pulled = await pullExternalEvents(startDate, endDate);
  } catch (err) {
    errors.push(
      `Pull failed: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  }

  // 4. Update last sync timestamp
  await db
    .update(integrationState)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(integrationState.provider, "google"));

  console.log(
    `[gcal] Sync complete: ${pushed} pushed, ${pulled} pulled, ${errors.length} errors`
  );

  return { pushed, pulled, errors };
}
