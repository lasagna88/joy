import { db } from "@/lib/db";
import { integrationState, tasks, calendarEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const SALESRABBIT_API_URL = "https://api.salesrabbit.com";

// Map SalesRabbit lead/appointment statuses to Papwa categories
const STATUS_TO_CATEGORY: Record<string, string> = {
  "Appointment Set": "appointment",
  "Appointment Completed": "follow_up",
  "Not Home": "door_knocking",
  "Not Interested": "other",
  "Sale Made": "admin",
  "Follow Up": "follow_up",
  "Knocked": "door_knocking",
  "Pending": "follow_up",
};

const STATUS_TO_PRIORITY: Record<string, string> = {
  "Appointment Set": "high",
  "Follow Up": "medium",
  "Appointment Completed": "medium",
  "Not Home": "low",
  "Sale Made": "low",
  "Pending": "medium",
};

/**
 * Connect SalesRabbit using an API token (no OAuth — token auth)
 */
export async function connect(apiToken: string): Promise<boolean> {
  // Verify the token works by making a test request
  try {
    const res = await fetch(`${SALESRABBIT_API_URL}/users/me`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return false;
    }

    // Store the token
    await db
      .insert(integrationState)
      .values({
        provider: "salesrabbit",
        accessToken: apiToken,
        isActive: true,
        config: {},
        lastSyncAt: null,
      })
      .onConflictDoUpdate({
        target: integrationState.provider,
        set: {
          accessToken: apiToken,
          isActive: true,
          updatedAt: new Date(),
        },
      });

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if SalesRabbit is connected
 */
export async function isConnected(): Promise<boolean> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(
      and(
        eq(integrationState.provider, "salesrabbit"),
        eq(integrationState.isActive, true)
      )
    );
  return !!state;
}

/**
 * Get connection status
 */
export async function getConnectionStatus() {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "salesrabbit"));

  if (!state) return { connected: false };

  return {
    connected: state.isActive,
    lastSyncAt: state.lastSyncAt,
  };
}

/**
 * Disconnect SalesRabbit
 */
export async function disconnect() {
  await db
    .update(integrationState)
    .set({
      isActive: false,
      accessToken: null,
      syncCursor: null,
      updatedAt: new Date(),
    })
    .where(eq(integrationState.provider, "salesrabbit"));
}

/**
 * Make an authenticated SalesRabbit API request
 */
async function srFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(
      and(
        eq(integrationState.provider, "salesrabbit"),
        eq(integrationState.isActive, true)
      )
    );

  if (!state?.accessToken) throw new Error("SalesRabbit not authenticated");

  return fetch(`${SALESRABBIT_API_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

interface SalesRabbitLead {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  status?: string;
  statusName?: string;
  notes?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  createdDate?: string;
  modifiedDate?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Sync leads from SalesRabbit.
 * New leads become Papwa tasks. Leads with appointments create calendar events.
 * Returns count of new items and whether any new appointments were found.
 */
export async function syncLeads(): Promise<{
  newTasks: number;
  newAppointments: number;
}> {
  let newTasks = 0;
  let newAppointments = 0;

  try {
    const [state] = await db
      .select()
      .from(integrationState)
      .where(eq(integrationState.provider, "salesrabbit"));

    // Build query params — use sync cursor if available
    let endpoint = "/leadStatusHistories?limit=100&sortDir=desc";
    if (state?.syncCursor) {
      endpoint += `&modifiedAfter=${state.syncCursor}`;
    }

    // First, try fetching leads directly
    const leadsRes = await srFetch("/leads?limit=100&sortDir=desc");

    if (!leadsRes.ok) {
      console.error("[salesrabbit] Leads fetch failed:", leadsRes.status);
      return { newTasks: 0, newAppointments: 0 };
    }

    const leadsData = await leadsRes.json();
    const leads: SalesRabbitLead[] = leadsData.data || leadsData || [];

    for (const lead of leads) {
      const externalId = `sr_${lead.id}`;
      const contactName = [lead.firstName, lead.lastName]
        .filter(Boolean)
        .join(" ");
      const location = [lead.address, lead.city, lead.state]
        .filter(Boolean)
        .join(", ");
      const statusName = lead.statusName || lead.status || "Pending";
      const category = STATUS_TO_CATEGORY[statusName] || "other";
      const priority = STATUS_TO_PRIORITY[statusName] || "medium";

      // Check if we already track this lead
      const [existing] = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.externalId, externalId),
            eq(tasks.externalSource, "salesrabbit")
          )
        );

      if (existing) {
        // Update existing task with new status
        await db
          .update(tasks)
          .set({
            title: `${statusName}: ${contactName || "Lead"}`,
            category: category as
              | "door_knocking"
              | "appointment"
              | "follow_up"
              | "admin"
              | "other",
            priority: priority as "urgent" | "high" | "medium" | "low",
            contactName: contactName || existing.contactName,
            contactPhone: lead.phone || existing.contactPhone,
            location: location || existing.location,
            metadata: {
              ...(existing.metadata as Record<string, unknown> || {}),
              salesrabbitStatus: statusName,
              salesrabbitLeadId: lead.id,
            },
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, existing.id));
      } else {
        // Create new task
        await db.insert(tasks).values({
          title: `${statusName}: ${contactName || "Lead"}`,
          description: lead.notes || `SalesRabbit lead: ${contactName}`,
          status: "inbox",
          category: category as
            | "door_knocking"
            | "appointment"
            | "follow_up"
            | "admin"
            | "other",
          priority: priority as "urgent" | "high" | "medium" | "low",
          contactName: contactName || undefined,
          contactPhone: lead.phone || undefined,
          location: location || undefined,
          externalId,
          externalSource: "salesrabbit",
          metadata: {
            salesrabbitStatus: statusName,
            salesrabbitLeadId: lead.id,
            salesrabbitEmail: lead.email,
          },
        });
        newTasks++;
      }

      // If lead has an appointment date, create a calendar event
      if (
        lead.appointmentDate &&
        (statusName === "Appointment Set" || lead.appointmentTime)
      ) {
        const appointmentExternalId = `sr_appt_${lead.id}`;

        const [existingEvent] = await db
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.source, "salesrabbit"),
              eq(
                calendarEvents.metadata,
                // Can't query jsonb directly with eq, check by googleEventId field repurposed
                // Instead, search by title pattern
                undefined as unknown as typeof calendarEvents.metadata
              )
            )
          )
          .limit(0); // Skip this query — we'll check differently

        // Check by external reference in metadata
        const existingEvents = await db
          .select()
          .from(calendarEvents)
          .where(eq(calendarEvents.source, "salesrabbit"));

        const alreadyExists = existingEvents.find(
          (e) =>
            (e.metadata as Record<string, unknown>)?.salesrabbitLeadId ===
            lead.id
        );

        if (!alreadyExists) {
          // Parse appointment datetime
          let startTime: Date;
          if (lead.appointmentTime) {
            startTime = new Date(
              `${lead.appointmentDate}T${lead.appointmentTime}`
            );
          } else {
            startTime = new Date(`${lead.appointmentDate}T09:00:00`);
          }

          // Default 1-hour appointment
          const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

          // Only create future appointments
          if (startTime.getTime() > Date.now()) {
            await db.insert(calendarEvents).values({
              title: `Appointment: ${contactName || "Lead"}`,
              description: lead.notes || undefined,
              startTime,
              endTime,
              location: location || undefined,
              source: "salesrabbit",
              isBlocker: true, // Appointments are fixed anchors
              color: "blue",
              metadata: {
                category: "appointment",
                salesrabbitLeadId: lead.id,
                salesrabbitExternalId: appointmentExternalId,
                contactPhone: lead.phone,
              },
            });
            newAppointments++;
          }
        }
      }
    }
  } catch (err) {
    console.error("[salesrabbit] Lead sync error:", err);
  }

  return { newTasks, newAppointments };
}

/**
 * Full SalesRabbit sync
 */
export async function fullSync(): Promise<{
  newTasks: number;
  newAppointments: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let newTasks = 0;
  let newAppointments = 0;

  try {
    const result = await syncLeads();
    newTasks = result.newTasks;
    newAppointments = result.newAppointments;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Sync failed");
  }

  // Update last sync timestamp
  await db
    .update(integrationState)
    .set({
      lastSyncAt: new Date(),
      syncCursor: new Date().toISOString(),
      updatedAt: new Date(),
    })
    .where(eq(integrationState.provider, "salesrabbit"));

  console.log(
    `[salesrabbit] Sync complete: ${newTasks} tasks, ${newAppointments} appointments, ${errors.length} errors`
  );

  return { newTasks, newAppointments, errors };
}

/**
 * Handle a SalesRabbit webhook (new lead or status change)
 */
export async function handleWebhook(
  payload: Record<string, unknown>
): Promise<{ needsReplan: boolean }> {
  console.log("[salesrabbit] Webhook received:", payload.event || "unknown");

  // Run a sync to capture the change
  const result = await fullSync();

  // If new appointments were found, signal that a replan is needed
  return { needsReplan: result.newAppointments > 0 };
}
