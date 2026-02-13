import { db } from "@/lib/db";
import { integrationState, tasks, calendarEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { Queue } from "bullmq";
import Redis from "ioredis";

const SALESRABBIT_API_URL = "https://api.salesrabbit.com";

// Map SalesRabbit lead/appointment statuses to Joy categories
const STATUS_TO_CATEGORY: Record<string, string> = {
  "Appointment Set": "appointment",
  "Appointment Completed": "follow_up",
  "Not Home": "door_knocking",
  "Not Interested": "other",
  "Sale Made": "admin",
  "Follow Up": "follow_up",
  "Knocked": "door_knocking",
  "Pending": "follow_up",
  "Callback": "follow_up",
};

const STATUS_TO_PRIORITY: Record<string, string> = {
  "Appointment Set": "high",
  "Follow Up": "medium",
  "Appointment Completed": "medium",
  "Not Home": "low",
  "Sale Made": "low",
  "Pending": "medium",
  "Callback": "high",
};

/**
 * Connect SalesRabbit using an API token (no OAuth — token auth).
 * Discovers the current user ID for owner-filtered syncs.
 */
export async function connect(apiToken: string): Promise<boolean> {
  // Verify the token works and discover the current user
  try {
    const res = await fetch(`${SALESRABBIT_API_URL}/users?limit=1`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error("[salesrabbit] Auth test failed:", res.status, await res.text().catch(() => ""));
      return false;
    }

    // Try to extract the current user ID from the response
    let currentUserId: string | undefined;
    try {
      const userData = await res.json();
      const users = userData.data || userData || [];
      if (users.length > 0) {
        currentUserId = String(users[0].id);
        console.log("[salesrabbit] Current user ID:", currentUserId);
      }
    } catch {
      // Non-fatal — sync will work without filtering
    }

    // Store the token and user ID
    await db
      .insert(integrationState)
      .values({
        provider: "salesrabbit",
        accessToken: apiToken,
        isActive: true,
        config: { userId: currentUserId },
        lastSyncAt: null,
      })
      .onConflictDoUpdate({
        target: integrationState.provider,
        set: {
          accessToken: apiToken,
          isActive: true,
          config: { userId: currentUserId },
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

export interface SalesRabbitLead {
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
  customFields?: Record<string, string>;
}

export interface CallbackTriggerConfig {
  enabled: boolean;
  statusNameMatch: string;
  customFieldName: string;
  customFieldValue: string;
  proposalPrepMinutes: number;
}

export const DEFAULT_CALLBACK_CONFIG: CallbackTriggerConfig = {
  enabled: false,
  statusNameMatch: "Callback",
  customFieldName: "",
  customFieldValue: "",
  proposalPrepMinutes: 90,
};

/**
 * Check if a lead matches the callback trigger criteria
 */
export function isCallbackLead(
  lead: SalesRabbitLead,
  config: CallbackTriggerConfig
): boolean {
  if (!config.enabled) return false;

  // Check status name match
  const statusName = lead.statusName || lead.status || "";
  if (
    config.statusNameMatch &&
    statusName.toLowerCase() === config.statusNameMatch.toLowerCase()
  ) {
    return true;
  }

  // Check custom field match
  if (config.customFieldName && lead.customFields) {
    const fieldValue = lead.customFields[config.customFieldName];
    if (fieldValue) {
      if (!config.customFieldValue) return true; // any truthy value
      if (fieldValue.toLowerCase() === config.customFieldValue.toLowerCase()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract callback config from integration state config
 */
function getCallbackConfig(
  config: Record<string, unknown>
): CallbackTriggerConfig {
  const ct = config.callbackTrigger as Partial<CallbackTriggerConfig> | undefined;
  return { ...DEFAULT_CALLBACK_CONFIG, ...ct };
}

/**
 * Get the current callback trigger config from DB
 */
export async function getCallbackTriggerConfig(): Promise<CallbackTriggerConfig> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "salesrabbit"));
  const config = (state?.config as Record<string, unknown>) || {};
  return getCallbackConfig(config);
}

/**
 * Update callback trigger config
 */
export async function setCallbackTriggerConfig(
  updates: Partial<CallbackTriggerConfig>
): Promise<CallbackTriggerConfig> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "salesrabbit"));

  const config = (state?.config as Record<string, unknown>) || {};
  const current = getCallbackConfig(config);
  const merged = { ...current, ...updates };

  await db
    .update(integrationState)
    .set({
      config: { ...config, callbackTrigger: merged },
      updatedAt: new Date(),
    })
    .where(eq(integrationState.provider, "salesrabbit"));

  return merged;
}

/**
 * Sync leads from SalesRabbit.
 * New leads become Joy tasks. Leads with appointments create calendar events.
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

    // Get the stored user ID for filtering
    const config = (state?.config as Record<string, string>) || {};
    const userId = config.userId;

    // Fetch leads filtered by current user if available
    let leadsEndpoint = "/leads?limit=100&sortDir=desc";
    if (userId) {
      leadsEndpoint += `&userId=${userId}`;
    }

    const leadsRes = await srFetch(leadsEndpoint);

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

      // Check for callback trigger
      const callbackConfig = getCallbackConfig(config);
      const existingMeta = existing?.metadata as Record<string, unknown> | null;
      if (
        callbackConfig.enabled &&
        isCallbackLead(lead, callbackConfig) &&
        !existingMeta?.callbackProcessed
      ) {
        // Mark as processed to prevent re-trigger
        if (existing) {
          await db
            .update(tasks)
            .set({
              metadata: {
                ...(existingMeta || {}),
                callbackProcessed: true,
              },
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, existing.id));
        }

        // Enqueue callback workflow with 10 min delay
        try {
          const redisConn = new Redis(
            process.env.REDIS_URL || "redis://localhost:6379",
            { maxRetriesPerRequest: null }
          );
          const syncQueue = new Queue("sync", { connection: redisConn });
          await syncQueue.add(
            "callback-workflow",
            {
              lead: {
                id: lead.id,
                firstName: lead.firstName,
                lastName: lead.lastName,
                phone: lead.phone,
                email: lead.email,
                address: lead.address,
                city: lead.city,
                state: lead.state,
                zip: lead.zip,
                notes: lead.notes,
                customFields: lead.customFields,
              },
              proposalPrepMinutes: callbackConfig.proposalPrepMinutes,
            },
            {
              delay: 10 * 60 * 1000, // 10 minutes
              attempts: 4,
              backoff: { type: "custom" },
            }
          );
          await redisConn.quit();
          console.log(`[salesrabbit] Callback workflow queued for lead ${lead.id}`);
        } catch (err) {
          console.error("[salesrabbit] Failed to enqueue callback workflow:", err);
        }
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
 * Wipe all SalesRabbit-sourced tasks and events, reset sync cursor.
 * Used when reconfiguring owner filtering.
 */
export async function wipeAndReset(): Promise<number> {
  const deleted = await db
    .delete(tasks)
    .where(eq(tasks.externalSource, "salesrabbit"))
    .returning();

  const deletedEvents = await db
    .delete(calendarEvents)
    .where(eq(calendarEvents.source, "salesrabbit"))
    .returning();

  await db
    .update(integrationState)
    .set({ syncCursor: null, updatedAt: new Date() })
    .where(eq(integrationState.provider, "salesrabbit"));

  console.log(`[salesrabbit] Wiped ${deleted.length} tasks, ${deletedEvents.length} events`);
  return deleted.length + deletedEvents.length;
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
