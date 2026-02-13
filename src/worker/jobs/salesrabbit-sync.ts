import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../lib/db/schema";
import { eq, and } from "drizzle-orm";
import { Queue } from "bullmq";
import Redis from "ioredis";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

const SALESRABBIT_API_URL = "https://api.salesrabbit.com";

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

interface CallbackTriggerConfig {
  enabled: boolean;
  statusNameMatch: string;
  customFieldName: string;
  customFieldValue: string;
  proposalPrepMinutes: number;
}

const DEFAULT_CALLBACK_CONFIG: CallbackTriggerConfig = {
  enabled: false,
  statusNameMatch: "Callback",
  customFieldName: "",
  customFieldValue: "",
  proposalPrepMinutes: 90,
};

function getCallbackConfig(config: Record<string, unknown>): CallbackTriggerConfig {
  const ct = config.callbackTrigger as Partial<CallbackTriggerConfig> | undefined;
  return { ...DEFAULT_CALLBACK_CONFIG, ...ct };
}

function isCallbackLead(
  lead: { statusName?: string; status?: string; customFields?: Record<string, string> },
  config: CallbackTriggerConfig
): boolean {
  if (!config.enabled) return false;

  const statusName = lead.statusName || lead.status || "";
  if (
    config.statusNameMatch &&
    statusName.toLowerCase() === config.statusNameMatch.toLowerCase()
  ) {
    return true;
  }

  if (config.customFieldName && lead.customFields) {
    const fieldValue = lead.customFields[config.customFieldName];
    if (fieldValue) {
      if (!config.customFieldValue) return true;
      if (fieldValue.toLowerCase() === config.customFieldValue.toLowerCase()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * SalesRabbit sync worker job — runs every 15 minutes.
 * Pulls leads, creates tasks, creates appointment events.
 * Triggers AI replan when new appointments are discovered.
 */
export async function runSalesRabbitSync() {
  console.log("[salesrabbit-sync] Starting SalesRabbit sync...");

  // Check if connected
  const [state] = await db
    .select()
    .from(schema.integrationState)
    .where(
      and(
        eq(schema.integrationState.provider, "salesrabbit"),
        eq(schema.integrationState.isActive, true)
      )
    );

  if (!state?.accessToken) {
    console.log("[salesrabbit-sync] SalesRabbit not connected, skipping");
    return;
  }

  const headers = {
    Authorization: `Bearer ${state.accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Get stored user ID for owner filtering
  const config = (state.config as Record<string, string>) || {};
  const userId = config.userId;

  let newTasks = 0;
  let newAppointments = 0;

  try {
    let leadsEndpoint = `${SALESRABBIT_API_URL}/leads?limit=100&sortDir=desc`;
    if (userId) {
      leadsEndpoint += `&userId=${userId}`;
    }

    const res = await fetch(leadsEndpoint, { headers });

    if (!res.ok) {
      if (res.status === 401) {
        console.error("[salesrabbit-sync] Auth failed, marking inactive");
        await db
          .update(schema.integrationState)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.integrationState.provider, "salesrabbit"));
      } else {
        console.error("[salesrabbit-sync] Leads fetch failed:", res.status);
      }
      return;
    }

    const data = await res.json();
    const leads = data.data || data || [];

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

      // Check existing task
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
        await db
          .update(schema.tasks)
          .set({
            title: `${statusName}: ${contactName || "Lead"}`,
            category: category as "appointment" | "follow_up" | "door_knocking" | "admin" | "other",
            priority: priority as "urgent" | "high" | "medium" | "low",
            contactName: contactName || existing.contactName,
            contactPhone: lead.phone || existing.contactPhone,
            location: location || existing.location,
            metadata: {
              ...(existing.metadata as Record<string, unknown> || {}),
              salesrabbitStatus: statusName,
            },
            updatedAt: new Date(),
          })
          .where(eq(schema.tasks.id, existing.id));
      } else {
        await db.insert(schema.tasks).values({
          title: `${statusName}: ${contactName || "Lead"}`,
          description: lead.notes || `SalesRabbit lead: ${contactName}`,
          status: "inbox",
          category: category as "appointment" | "follow_up" | "door_knocking" | "admin" | "other",
          priority: priority as "urgent" | "high" | "medium" | "low",
          contactName: contactName || undefined,
          contactPhone: lead.phone || undefined,
          location: location || undefined,
          externalId,
          externalSource: "salesrabbit",
          metadata: {
            salesrabbitStatus: statusName,
            salesrabbitLeadId: lead.id,
          },
        });
        newTasks++;
      }

      // Check for callback trigger
      const callbackConfig = getCallbackConfig(config as Record<string, unknown>);
      const existingMeta = existing?.metadata as Record<string, unknown> | null;
      if (
        callbackConfig.enabled &&
        isCallbackLead(lead, callbackConfig) &&
        !existingMeta?.callbackProcessed
      ) {
        // Mark as processed
        if (existing) {
          await db
            .update(schema.tasks)
            .set({
              metadata: { ...(existingMeta || {}), callbackProcessed: true },
              updatedAt: new Date(),
            })
            .where(eq(schema.tasks.id, existing.id));
        }

        // Enqueue callback workflow with 10 min delay
        try {
          const callbackConn = new Redis(
            process.env.REDIS_URL || "redis://localhost:6379",
            { maxRetriesPerRequest: null }
          );
          const callbackQueue = new Queue("sync", { connection: callbackConn });
          await callbackQueue.add(
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
              delay: 10 * 60 * 1000,
              attempts: 4,
              backoff: { type: "custom" },
            }
          );
          await callbackConn.quit();
          console.log(
            `[salesrabbit-sync] Callback workflow queued for lead ${lead.id}`
          );
        } catch (err) {
          console.error("[salesrabbit-sync] Failed to enqueue callback:", err);
        }
      }

      // Handle appointments
      if (
        lead.appointmentDate &&
        (statusName === "Appointment Set" || lead.appointmentTime)
      ) {
        const existingEvents = await db
          .select()
          .from(schema.calendarEvents)
          .where(eq(schema.calendarEvents.source, "salesrabbit"));

        const alreadyExists = existingEvents.find(
          (e) =>
            (e.metadata as Record<string, unknown>)?.salesrabbitLeadId ===
            lead.id
        );

        if (!alreadyExists) {
          let startTime: Date;
          if (lead.appointmentTime) {
            startTime = new Date(
              `${lead.appointmentDate}T${lead.appointmentTime}`
            );
          } else {
            startTime = new Date(`${lead.appointmentDate}T09:00:00`);
          }

          const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

          if (startTime.getTime() > Date.now()) {
            await db.insert(schema.calendarEvents).values({
              title: `Appointment: ${contactName || "Lead"}`,
              description: lead.notes || undefined,
              startTime,
              endTime,
              location: location || undefined,
              source: "salesrabbit",
              isBlocker: true,
              color: "blue",
              metadata: {
                category: "appointment",
                salesrabbitLeadId: lead.id,
                contactPhone: lead.phone,
              },
            });
            newAppointments++;
          }
        }
      }
    }
  } catch (err) {
    console.error("[salesrabbit-sync] Sync error:", err);
  }

  // Update sync state
  await db
    .update(schema.integrationState)
    .set({
      lastSyncAt: new Date(),
      syncCursor: new Date().toISOString(),
      updatedAt: new Date(),
    })
    .where(eq(schema.integrationState.provider, "salesrabbit"));

  // Trigger replan if new appointments were found
  if (newAppointments > 0) {
    console.log(
      `[salesrabbit-sync] ${newAppointments} new appointments found, triggering replan`
    );
    try {
      const connection = new Redis(
        process.env.REDIS_URL || "redis://localhost:6379",
        { maxRetriesPerRequest: null }
      );
      const planningQueue = new Queue("planning", { connection });
      await planningQueue.add("replan", {
        date: new Date().toISOString().split("T")[0],
        reason: `${newAppointments} new SalesRabbit appointment(s)`,
      });
      await connection.quit();
    } catch (err) {
      console.error("[salesrabbit-sync] Failed to trigger replan:", err);
    }
  }

  console.log(
    `[salesrabbit-sync] Complete: ${newTasks} tasks, ${newAppointments} appointments`
  );
}
