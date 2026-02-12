import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.com";
const BIGIN_API_URL = "https://www.zohoapis.com/bigin/v2";

// Stage-to-category mapping (mirrors the one in lib/bigin)
const STAGE_TO_CATEGORY: Record<string, string> = {
  "Qualification": "follow_up",
  "Needs Analysis": "follow_up",
  "Appointment Set": "appointment",
  "Appointment Scheduled": "appointment",
  "Proposal": "follow_up",
  "Negotiation": "follow_up",
  "Closed Won": "admin",
  "Closed Lost": "admin",
  "Follow Up": "follow_up",
  "Site Survey": "appointment",
  "Installation": "appointment",
  "Design Review": "admin",
};

const STAGE_TO_PRIORITY: Record<string, string> = {
  "Appointment Set": "high",
  "Appointment Scheduled": "high",
  "Negotiation": "high",
  "Site Survey": "high",
  "Installation": "urgent",
  "Proposal": "medium",
  "Follow Up": "medium",
  "Qualification": "low",
  "Needs Analysis": "low",
};

/**
 * Bigin sync worker job — runs every 15 minutes.
 * Uses its own DB connection (worker runs in separate process).
 */
export async function runBiginSync() {
  console.log("[bigin-sync] Starting Bigin sync...");

  // Check if Bigin is connected
  const [state] = await db
    .select()
    .from(schema.integrationState)
    .where(
      and(
        eq(schema.integrationState.provider, "bigin"),
        eq(schema.integrationState.isActive, true)
      )
    );

  if (!state?.accessToken) {
    console.log("[bigin-sync] Bigin not connected, skipping");
    return;
  }

  // Get a valid token, refreshing if needed
  let token = state.accessToken;
  const expiresAt = state.tokenExpiresAt?.getTime() || 0;

  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    if (!state.refreshToken) {
      console.error("[bigin-sync] No refresh token, marking inactive");
      await db
        .update(schema.integrationState)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.integrationState.provider, "bigin"));
      return;
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID || "",
      client_secret: process.env.ZOHO_CLIENT_SECRET || "",
      refresh_token: state.refreshToken,
    });

    try {
      const res = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!res.ok) {
        console.error("[bigin-sync] Token refresh failed:", res.status);
        await db
          .update(schema.integrationState)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.integrationState.provider, "bigin"));
        return;
      }

      const data = await res.json();
      if (!data.access_token) {
        console.error("[bigin-sync] No access token in refresh response");
        return;
      }

      token = data.access_token;
      await db
        .update(schema.integrationState)
        .set({
          accessToken: token,
          tokenExpiresAt: new Date(
            Date.now() + (data.expires_in || 3600) * 1000
          ),
          updatedAt: new Date(),
        })
        .where(eq(schema.integrationState.provider, "bigin"));
    } catch (err) {
      console.error("[bigin-sync] Token refresh error:", err);
      return;
    }
  }

  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    "Content-Type": "application/json",
  };

  let dealsSynced = 0;
  let tasksSynced = 0;

  // 1. Sync deals
  try {
    let endpoint = `${BIGIN_API_URL}/Deals?fields=Deal_Name,Stage,Contact_Name,Phone,Email,Amount,Closing_Date,Description,Modified_Time,Address&per_page=100`;
    if (state.syncCursor) {
      endpoint += `&modified_since=${state.syncCursor}`;
    }

    const res = await fetch(endpoint, { headers });

    if (res.ok) {
      const data = await res.json();
      const deals = data.data || [];

      for (const deal of deals) {
        const category = STAGE_TO_CATEGORY[deal.Stage] || "other";
        const priority = STAGE_TO_PRIORITY[deal.Stage] || "medium";
        const contactName = deal.Contact_Name?.name || undefined;

        const [existing] = await db
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.externalId, deal.id),
              eq(schema.tasks.externalSource, "bigin")
            )
          );

        if (existing) {
          await db
            .update(schema.tasks)
            .set({
              title: `${deal.Stage}: ${deal.Deal_Name}`,
              category: category as "appointment" | "follow_up" | "admin" | "other",
              priority: priority as "urgent" | "high" | "medium" | "low",
              contactName,
              contactPhone: deal.Phone || existing.contactPhone,
              location: deal.Address || existing.location,
              deadline: deal.Closing_Date
                ? new Date(deal.Closing_Date)
                : existing.deadline,
              metadata: {
                ...(existing.metadata as Record<string, unknown> || {}),
                biginStage: deal.Stage,
                biginAmount: deal.Amount,
              },
              updatedAt: new Date(),
            })
            .where(eq(schema.tasks.id, existing.id));
        } else if (deal.Stage !== "Closed Won" && deal.Stage !== "Closed Lost") {
          await db.insert(schema.tasks).values({
            title: `${deal.Stage}: ${deal.Deal_Name}`,
            description: deal.Description || `Bigin deal: ${deal.Deal_Name}`,
            status: "inbox",
            category: category as "appointment" | "follow_up" | "admin" | "other",
            priority: priority as "urgent" | "high" | "medium" | "low",
            contactName,
            contactPhone: deal.Phone || undefined,
            location: deal.Address || undefined,
            deadline: deal.Closing_Date
              ? new Date(deal.Closing_Date)
              : undefined,
            externalId: deal.id,
            externalSource: "bigin",
            metadata: {
              biginStage: deal.Stage,
              biginAmount: deal.Amount,
            },
          });
          dealsSynced++;
        }
      }
    } else if (res.status !== 304) {
      console.error("[bigin-sync] Deals fetch failed:", res.status);
    }
  } catch (err) {
    console.error("[bigin-sync] Deal sync error:", err);
  }

  // 2. Sync Bigin tasks
  try {
    const res = await fetch(
      `${BIGIN_API_URL}/Tasks?fields=Subject,Status,Priority,Due_Date,Description,What_Id,Modified_Time&per_page=100`,
      { headers }
    );

    if (res.ok) {
      const data = await res.json();
      const biginTasks = data.data || [];

      for (const bt of biginTasks) {
        if (bt.Status === "Completed") continue;

        const externalId = `task_${bt.id}`;
        const priority =
          bt.Priority === "High"
            ? "high"
            : bt.Priority === "Highest"
            ? "urgent"
            : bt.Priority === "Low"
            ? "low"
            : "medium";

        const [existing] = await db
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.externalId, externalId),
              eq(schema.tasks.externalSource, "bigin")
            )
          );

        if (existing) {
          await db
            .update(schema.tasks)
            .set({
              title: bt.Subject,
              priority: priority as "urgent" | "high" | "medium" | "low",
              deadline: bt.Due_Date
                ? new Date(bt.Due_Date)
                : existing.deadline,
              updatedAt: new Date(),
            })
            .where(eq(schema.tasks.id, existing.id));
        } else {
          await db.insert(schema.tasks).values({
            title: bt.Subject,
            description: bt.Description || undefined,
            status: "inbox",
            category: "follow_up",
            priority: priority as "urgent" | "high" | "medium" | "low",
            deadline: bt.Due_Date ? new Date(bt.Due_Date) : undefined,
            externalId,
            externalSource: "bigin",
            metadata: {
              biginTaskId: bt.id,
              biginRelatedTo: bt.What_Id?.name,
            },
          });
          tasksSynced++;
        }
      }
    } else if (res.status !== 304) {
      console.error("[bigin-sync] Tasks fetch failed:", res.status);
    }
  } catch (err) {
    console.error("[bigin-sync] Task sync error:", err);
  }

  // Update sync cursor and timestamp
  await db
    .update(schema.integrationState)
    .set({
      lastSyncAt: new Date(),
      syncCursor: new Date().toISOString(),
      updatedAt: new Date(),
    })
    .where(eq(schema.integrationState.provider, "bigin"));

  console.log(
    `[bigin-sync] Complete: ${dealsSynced} deals, ${tasksSynced} tasks imported`
  );
}
