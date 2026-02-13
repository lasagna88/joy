import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../lib/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { google } from "googleapis";
import { Job } from "bullmq";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

const DEFAULT_ZOHO_ACCOUNTS_URL = "https://accounts.zoho.com";

interface CallbackWorkflowData {
  lead: {
    id: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    notes?: string;
    customFields?: Record<string, string>;
  };
  proposalPrepMinutes: number;
  biginDealId?: string; // Set after first attempt creates the deal
}

/**
 * Custom backoff strategy for callback workflow retries.
 * Attempt 1 (initial): 10 min delay (already done via job.opts.delay)
 * Attempt 2: +30 min
 * Attempt 3: +1 hr
 * Attempt 4: +2 hr
 */
export function getCallbackBackoffDelay(attemptsMade: number): number {
  switch (attemptsMade) {
    case 1:
      return 30 * 60 * 1000; // 30 min
    case 2:
      return 60 * 60 * 1000; // 1 hr
    case 3:
      return 2 * 60 * 60 * 1000; // 2 hr
    default:
      return 60 * 60 * 1000;
  }
}

/**
 * Get a valid Bigin access token, refreshing if needed.
 * Worker-style: uses its own DB connection.
 */
async function getBiginToken(): Promise<{
  token: string;
  apiUrl: string;
} | null> {
  const [state] = await db
    .select()
    .from(schema.integrationState)
    .where(
      and(
        eq(schema.integrationState.provider, "bigin"),
        eq(schema.integrationState.isActive, true)
      )
    );

  if (!state?.accessToken) return null;

  const config = (state.config as Record<string, string>) || {};
  const accountsUrl = config.accountsUrl || DEFAULT_ZOHO_ACCOUNTS_URL;
  const apiUrl = `${process.env.ZOHO_API_URL || "https://www.zohoapis.com"}/bigin/v2`;

  let token = state.accessToken;
  const expiresAt = state.tokenExpiresAt?.getTime() || 0;

  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    if (!state.refreshToken) return null;

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID || "",
      client_secret: process.env.ZOHO_CLIENT_SECRET || "",
      refresh_token: state.refreshToken,
    });

    const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.access_token) return null;

    token = data.access_token;
    await db
      .update(schema.integrationState)
      .set({
        accessToken: token,
        tokenExpiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationState.provider, "bigin"));
  }

  return { token, apiUrl };
}

/**
 * Discover Bigin custom fields for Deals module
 */
async function discoverBiginDealFields(
  token: string,
  apiUrl: string
): Promise<Record<string, { label: string; type: string }>> {
  const res = await fetch(`${apiUrl}/settings/fields?module=Deals`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) return {};

  const data = await res.json();
  const fields: Record<string, { label: string; type: string }> = {};
  for (const f of data.fields || []) {
    fields[f.api_name] = { label: f.field_label, type: f.data_type };
  }
  return fields;
}

/**
 * Step 1: Create a Bigin deal from the SalesRabbit lead data
 */
async function createBiginDeal(
  lead: CallbackWorkflowData["lead"]
): Promise<string | null> {
  const bigin = await getBiginToken();
  if (!bigin) {
    console.log("[callback-workflow] Bigin not connected, skipping deal creation");
    return null;
  }

  const { token, apiUrl } = bigin;

  const contactName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const fullAddress = [lead.address, lead.city, lead.state, lead.zip]
    .filter(Boolean)
    .join(", ");

  const dealRecord: Record<string, unknown> = {
    Deal_Name: `${contactName || "Lead"} - Solar Proposal`,
    Stage: "Qualification",
  };

  if (lead.phone) dealRecord.Phone = lead.phone;
  if (lead.email) dealRecord.Email = lead.email;
  if (fullAddress) dealRecord.Address = fullAddress;

  // Process custom fields
  const solarDetails: Record<string, string> = {};
  const solarFieldKeys = [
    "roof type", "meter", "main breaker", "property type", "need", "country",
  ];

  let biginCustomFields: Record<string, { label: string; type: string }> = {};
  if (lead.customFields && Object.keys(lead.customFields).length > 0) {
    biginCustomFields = await discoverBiginDealFields(token, apiUrl);
  }

  if (lead.customFields) {
    for (const [key, value] of Object.entries(lead.customFields)) {
      if (!value) continue;
      const keyLower = key.toLowerCase();

      if (keyLower === "budget" && !isNaN(Number(value))) {
        dealRecord.Amount = Number(value);
        continue;
      }
      if (keyLower === "timeline" && !isNaN(Date.parse(value))) {
        dealRecord.Closing_Date = value;
        continue;
      }

      const isSolarField = solarFieldKeys.some((sf) => keyLower.includes(sf));
      if (isSolarField) {
        const matchingField = Object.entries(biginCustomFields).find(
          ([, meta]) => meta.label.toLowerCase().includes(keyLower)
        );
        if (matchingField) {
          dealRecord[matchingField[0]] = value;
        } else {
          solarDetails[key] = value;
        }
      }
    }
  }

  let description = lead.notes || "";
  if (Object.keys(solarDetails).length > 0) {
    description += "\n\n--- Solar Details ---";
    for (const [key, value] of Object.entries(solarDetails)) {
      description += `\n${key}: ${value}`;
    }
  }
  if (description) dealRecord.Description = description;

  try {
    const res = await fetch(`${apiUrl}/Deals`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: [dealRecord] }),
    });

    if (!res.ok) {
      console.error("[callback-workflow] Bigin deal creation failed:", res.status);
      return null;
    }

    const data = await res.json();
    const created = data.data?.[0];
    if (created?.details?.id) {
      console.log("[callback-workflow] Bigin deal created:", created.details.id);
      return String(created.details.id);
    }
    return null;
  } catch (err) {
    console.error("[callback-workflow] Bigin deal creation error:", err);
    return null;
  }
}

/**
 * Step 2: Create a Joy task "Prepare proposal for [Name]"
 */
async function createProposalTask(
  lead: CallbackWorkflowData["lead"],
  prepMinutes: number
): Promise<string | null> {
  const contactName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const externalId = `sr_proposal_${lead.id}`;

  // Check for existing proposal task (dedup)
  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.externalId, externalId),
        eq(schema.tasks.externalSource, "salesrabbit")
      )
    );

  if (existing) {
    console.log("[callback-workflow] Proposal task already exists:", existing.id);
    return existing.id;
  }

  const location = [lead.address, lead.city, lead.state]
    .filter(Boolean)
    .join(", ");

  const [task] = await db
    .insert(schema.tasks)
    .values({
      title: `Prepare proposal for ${contactName || "Lead"}`,
      description: `Prepare solar proposal for ${contactName}${location ? ` at ${location}` : ""}`,
      status: "inbox",
      category: "admin",
      priority: "high",
      estimatedMinutes: prepMinutes,
      contactName: contactName || undefined,
      contactPhone: lead.phone || undefined,
      location: location || undefined,
      externalId,
      externalSource: "salesrabbit",
      metadata: {
        salesrabbitLeadId: lead.id,
        callbackProposal: true,
        salesrabbitEmail: lead.email,
      },
    })
    .returning();

  console.log("[callback-workflow] Proposal task created:", task.id);
  return task.id;
}

/**
 * Step 3: Search Google Calendar for a matching appointment.
 * Fuzzy match: event text contains last name OR street address.
 */
async function findMatchingAppointment(
  lead: CallbackWorkflowData["lead"]
): Promise<{ eventId: string; startTime: Date; endTime: Date } | null> {
  // First check local Joy calendar events
  const now = new Date();
  const sixtyDaysOut = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const localEvents = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        gte(schema.calendarEvents.startTime, now),
        lte(schema.calendarEvents.startTime, sixtyDaysOut)
      )
    );

  const lastName = lead.lastName?.toLowerCase() || "";
  const streetAddress = lead.address?.toLowerCase().split(",")[0]?.trim() || "";

  // Search local events first
  for (const event of localEvents) {
    const text = `${event.title} ${event.description || ""} ${event.location || ""}`.toLowerCase();
    if (
      (lastName && text.includes(lastName)) ||
      (streetAddress && streetAddress.length > 3 && text.includes(streetAddress))
    ) {
      return {
        eventId: event.id,
        startTime: event.startTime,
        endTime: event.endTime,
      };
    }
  }

  // Then search Google Calendar
  const [state] = await db
    .select()
    .from(schema.integrationState)
    .where(
      and(
        eq(schema.integrationState.provider, "google"),
        eq(schema.integrationState.isActive, true)
      )
    );

  if (!state?.accessToken) return null;

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

  // Refresh token if needed
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
    } catch {
      return null;
    }
  }

  const cal = google.calendar({ version: "v3", auth: oauth2 });
  const config = (state.config as Record<string, string>) || {};

  // Search primary + work calendars
  const calendarIds = ["primary"];
  if (config.workCalendarId) calendarIds.push(config.workCalendarId);

  for (const calId of calendarIds) {
    try {
      const res = await cal.events.list({
        calendarId: calId,
        timeMin: now.toISOString(),
        timeMax: sixtyDaysOut.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 200,
      });

      for (const gEvent of res.data.items || []) {
        if (!gEvent.start?.dateTime || !gEvent.end?.dateTime) continue;
        if (gEvent.status === "cancelled") continue;

        const text = `${gEvent.summary || ""} ${gEvent.description || ""} ${gEvent.location || ""}`.toLowerCase();

        if (
          (lastName && text.includes(lastName)) ||
          (streetAddress && streetAddress.length > 3 && text.includes(streetAddress))
        ) {
          return {
            eventId: gEvent.id!,
            startTime: new Date(gEvent.start.dateTime),
            endTime: new Date(gEvent.end.dateTime),
          };
        }
      }
    } catch (err) {
      console.error(`[callback-workflow] Calendar search error (${calId}):`, err);
    }
  }

  return null;
}

/**
 * Step 4: Schedule the prep work before the appointment.
 * Creates a calendar event for proposal prep.
 */
async function schedulePrepWork(
  taskId: string,
  leadId: string,
  prepMinutes: number,
  appointmentStart: Date
): Promise<void> {
  // Check for existing prep event (dedup)
  const existingEvents = await db
    .select()
    .from(schema.calendarEvents)
    .where(eq(schema.calendarEvents.source, "ai_planned"));

  const alreadyScheduled = existingEvents.find(
    (e) =>
      (e.metadata as Record<string, unknown>)?.callbackPrepLeadId === leadId
  );

  if (alreadyScheduled) {
    console.log("[callback-workflow] Prep event already exists");
    return;
  }

  // Schedule prep: prepMinutes + 15 min buffer before appointment
  const bufferMinutes = 15;
  const prepEndTime = new Date(
    appointmentStart.getTime() - bufferMinutes * 60 * 1000
  );
  const prepStartTime = new Date(
    prepEndTime.getTime() - prepMinutes * 60 * 1000
  );

  await db.insert(schema.calendarEvents).values({
    title: "Prepare proposal",
    description: `Proposal prep time before appointment`,
    startTime: prepStartTime,
    endTime: prepEndTime,
    taskId,
    source: "ai_planned",
    isBlocker: false,
    color: "orange",
    metadata: {
      category: "admin",
      calendarType: "work",
      callbackPrepLeadId: leadId,
    },
  });

  // Update the task with deadline = appointment start time, status = scheduled
  await db
    .update(schema.tasks)
    .set({
      deadline: appointmentStart,
      status: "scheduled",
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, taskId));

  console.log(
    `[callback-workflow] Prep scheduled: ${prepStartTime.toISOString()} - ${prepEndTime.toISOString()}`
  );
}

/**
 * Main callback workflow handler.
 * Called from the sync queue worker.
 */
export async function runCallbackWorkflow(job: Job<CallbackWorkflowData>) {
  const { lead, proposalPrepMinutes } = job.data;
  const attemptsMade = job.attemptsMade;
  const contactName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");

  console.log(
    `[callback-workflow] Processing lead ${lead.id} (${contactName}), attempt ${attemptsMade + 1}`
  );

  // Step 1: Create Bigin deal (only on first attempt)
  let biginDealId = job.data.biginDealId;
  if (attemptsMade === 0) {
    biginDealId = (await createBiginDeal(lead)) || undefined;
    if (biginDealId) {
      await job.updateData({ ...job.data, biginDealId });
    }
  }

  // Step 2: Create Joy task (idempotent via externalId)
  const taskId = await createProposalTask(lead, proposalPrepMinutes);
  if (!taskId) {
    console.error("[callback-workflow] Failed to create proposal task");
    return;
  }

  // Step 3: Search for matching appointment
  const appointment = await findMatchingAppointment(lead);

  if (!appointment) {
    console.log(
      `[callback-workflow] No matching appointment found for ${contactName}, attempt ${attemptsMade + 1}/4`
    );
    // Throw to trigger retry (BullMQ will use our custom backoff)
    if (attemptsMade < 3) {
      throw new Error(
        `No matching appointment found for ${contactName} (attempt ${attemptsMade + 1})`
      );
    }
    // Final attempt — task exists but no prep scheduling
    console.log(
      `[callback-workflow] All attempts exhausted for ${contactName}. Task created, no prep scheduled.`
    );
    return;
  }

  // Step 4: Schedule prep work before the appointment
  console.log(
    `[callback-workflow] Found appointment at ${appointment.startTime.toISOString()}`
  );
  await schedulePrepWork(taskId, lead.id, proposalPrepMinutes, appointment.startTime);

  console.log(`[callback-workflow] Workflow complete for ${contactName}`);
}
