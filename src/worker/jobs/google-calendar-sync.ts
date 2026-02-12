import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../lib/db/schema";
import { eq, and } from "drizzle-orm";
import { google } from "googleapis";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

/**
 * Google Calendar sync job — runs every 30 minutes from the worker.
 *
 * Uses its own DB connection and Google client (worker runs in separate process).
 */
export async function runGoogleCalendarSync() {
  console.log("[gcal-sync] Starting Google Calendar sync...");

  // Check if Google is connected
  const [state] = await db
    .select()
    .from(schema.integrationState)
    .where(
      and(
        eq(schema.integrationState.provider, "google"),
        eq(schema.integrationState.isActive, true)
      )
    );

  if (!state?.accessToken) {
    console.log("[gcal-sync] Google Calendar not connected, skipping");
    return;
  }

  // Set up OAuth client
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2.setCredentials({
    access_token: state.accessToken,
    refresh_token: state.refreshToken,
    expiry_date: state.tokenExpiresAt?.getTime(),
  });

  // Refresh if needed
  const expiresAt = state.tokenExpiresAt?.getTime() || 0;
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      await db
        .update(schema.integrationState)
        .set({
          accessToken: credentials.access_token || state.accessToken,
          tokenExpiresAt: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : state.tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.integrationState.provider, "google"));
      oauth2.setCredentials(credentials);
    } catch (err) {
      console.error("[gcal-sync] Token refresh failed:", err);
      await db
        .update(schema.integrationState)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.integrationState.provider, "google"));
      return;
    }
  }

  const cal = google.calendar({ version: "v3", auth: oauth2 });

  // Joy calendar for pushing events, primary for pulling blockers
  let joyCalendarId =
    (state.config as Record<string, string>)?.joyCalendarId || "primary";

  // Lazy migration: create Joy calendar if not yet configured
  if (joyCalendarId === "primary") {
    try {
      const listRes = await cal.calendarList.list();
      const existing = listRes.data.items?.find(
        (c) => c.summary === "Joy" && c.accessRole === "owner"
      );
      if (existing?.id) {
        joyCalendarId = existing.id;
      } else {
        const createRes = await cal.calendars.insert({
          requestBody: {
            summary: "Joy",
            description: "Events planned by Joy AI",
          },
        });
        joyCalendarId = createRes.data.id!;
        await cal.calendarList.update({
          calendarId: joyCalendarId,
          requestBody: { colorId: "7" },
        });
      }
      await db
        .update(schema.integrationState)
        .set({
          config: { joyCalendarId },
          updatedAt: new Date(),
        })
        .where(eq(schema.integrationState.provider, "google"));
      console.log("[gcal-sync] Joy calendar ready:", joyCalendarId);
    } catch (err) {
      console.error("[gcal-sync] Failed to create Joy calendar:", err);
    }
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(startDate.getTime() + 8 * 24 * 60 * 60 * 1000);

  let pushed = 0;
  let pulled = 0;

  // 1. Push unpushed Joy events to the Joy calendar
  const { calendarEvents } = schema;
  const unpushedNull = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.source, "ai_planned"),
      )
    );

  const toPush = unpushedNull.filter(
    (e) =>
      !e.googleEventId &&
      e.startTime >= startDate &&
      e.startTime < endDate
  );

  for (const event of toPush) {
    try {
      const res = await cal.events.insert({
        calendarId: joyCalendarId,
        requestBody: {
          summary: event.title,
          description: event.description || undefined,
          location: event.location || undefined,
          start: { dateTime: event.startTime.toISOString() },
          end: { dateTime: event.endTime.toISOString() },
          extendedProperties: {
            private: { joyEventId: event.id },
          },
        },
      });

      if (res.data.id) {
        await db
          .update(calendarEvents)
          .set({ googleEventId: res.data.id, updatedAt: new Date() })
          .where(eq(calendarEvents.id, event.id));
        pushed++;
      }
    } catch (err) {
      console.error(`[gcal-sync] Failed to push "${event.title}":`, err);
    }
  }

  // 2. Pull external events as blockers from primary calendar
  try {
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100,
    });

    const googleEvents = res.data.items || [];

    for (const gEvent of googleEvents) {
      if (gEvent.extendedProperties?.private?.joyEventId) continue;
      if (!gEvent.start?.dateTime || !gEvent.end?.dateTime) continue;
      if (gEvent.status === "cancelled") continue;
      if (!gEvent.id) continue;

      const [existing] = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.googleEventId, gEvent.id));

      if (existing) {
        // Update if changed
        const sTime = new Date(gEvent.start.dateTime);
        const eTime = new Date(gEvent.end.dateTime);
        if (
          existing.title !== (gEvent.summary || "Busy") ||
          existing.startTime.getTime() !== sTime.getTime() ||
          existing.endTime.getTime() !== eTime.getTime()
        ) {
          await db
            .update(calendarEvents)
            .set({
              title: gEvent.summary || "Busy",
              startTime: sTime,
              endTime: eTime,
              location: gEvent.location || null,
              updatedAt: new Date(),
            })
            .where(eq(calendarEvents.id, existing.id));
        }
      } else {
        await db.insert(calendarEvents).values({
          title: gEvent.summary || "Busy",
          description: gEvent.description || null,
          startTime: new Date(gEvent.start.dateTime),
          endTime: new Date(gEvent.end.dateTime),
          location: gEvent.location || null,
          source: "google_calendar",
          googleEventId: gEvent.id,
          isBlocker: true,
          color: "slate",
          metadata: { category: "other", googleCalendar: true },
        });
        pulled++;
      }
    }
  } catch (err) {
    console.error("[gcal-sync] Failed to pull events:", err);
  }

  // 3. Update last sync time
  await db
    .update(schema.integrationState)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.integrationState.provider, "google"));

  console.log(
    `[gcal-sync] Complete: ${pushed} pushed, ${pulled} pulled`
  );
}
