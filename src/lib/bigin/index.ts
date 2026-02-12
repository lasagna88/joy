import { db } from "@/lib/db";
import { integrationState, tasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.com";
const BIGIN_API_URL = "https://www.zohoapis.com/bigin/v2";

// Map Bigin pipeline stages to Joy task categories
const STAGE_TO_CATEGORY: Record<string, string> = {
  // Common Bigin pipeline stages for solar sales
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

// Map Bigin pipeline stages to Joy task priorities
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
 * Generate the Zoho OAuth consent URL for Bigin access
 */
export function getAuthUrl(): string {
  const params = new URLSearchParams({
    scope: "ZohoBigin.modules.ALL,ZohoBigin.settings.ALL",
    client_id: process.env.ZOHO_CLIENT_ID || "",
    response_type: "code",
    access_type: "offline",
    redirect_uri: process.env.ZOHO_REDIRECT_URI || "",
    prompt: "consent",
  });

  return `${ZOHO_ACCOUNTS_URL}/oauth/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.ZOHO_CLIENT_ID || "",
    client_secret: process.env.ZOHO_CLIENT_SECRET || "",
    redirect_uri: process.env.ZOHO_REDIRECT_URI || "",
    code,
  });

  const res = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoho token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`Zoho OAuth error: ${data.error}`);
  }

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

  await db
    .insert(integrationState)
    .values({
      provider: "bigin",
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      tokenExpiresAt: expiresAt,
      isActive: true,
      config: { stageMapping: STAGE_TO_CATEGORY },
      lastSyncAt: null,
    })
    .onConflictDoUpdate({
      target: integrationState.provider,
      set: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || undefined,
        tokenExpiresAt: expiresAt,
        isActive: true,
        updatedAt: new Date(),
      },
    });

  return data;
}

/**
 * Refresh the Zoho access token
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<string | null> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID || "",
    client_secret: process.env.ZOHO_CLIENT_SECRET || "",
    refresh_token: refreshToken,
  });

  try {
    const res = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data.error || !data.access_token) return null;

    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

    await db
      .update(integrationState)
      .set({
        accessToken: data.access_token,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(integrationState.provider, "bigin"));

    return data.access_token;
  } catch (err) {
    console.error("[bigin] Token refresh failed:", err);
    return null;
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getAccessToken(): Promise<string | null> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(
      and(
        eq(integrationState.provider, "bigin"),
        eq(integrationState.isActive, true)
      )
    );

  if (!state?.accessToken) return null;

  // Refresh if expired or expiring within 5 min
  const expiresAt = state.tokenExpiresAt?.getTime() || 0;
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    if (!state.refreshToken) {
      await db
        .update(integrationState)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(integrationState.provider, "bigin"));
      return null;
    }

    const newToken = await refreshAccessToken(state.refreshToken);
    if (!newToken) {
      await db
        .update(integrationState)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(integrationState.provider, "bigin"));
      return null;
    }
    return newToken;
  }

  return state.accessToken;
}

/**
 * Make an authenticated Bigin API request
 */
async function biginFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new Error("Bigin not authenticated");

  return fetch(`${BIGIN_API_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/**
 * Check if Bigin is connected and active
 */
export async function isConnected(): Promise<boolean> {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(
      and(
        eq(integrationState.provider, "bigin"),
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
    .where(eq(integrationState.provider, "bigin"));

  if (!state) return { connected: false };

  return {
    connected: state.isActive,
    lastSyncAt: state.lastSyncAt,
  };
}

/**
 * Disconnect Bigin (revoke token + clear state)
 */
export async function disconnect() {
  const [state] = await db
    .select()
    .from(integrationState)
    .where(eq(integrationState.provider, "bigin"));

  if (state?.refreshToken) {
    try {
      await fetch(
        `${ZOHO_ACCOUNTS_URL}/oauth/v2/token/revoke?token=${state.refreshToken}`,
        { method: "POST" }
      );
    } catch {
      // Token may already be invalid
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
    .where(eq(integrationState.provider, "bigin"));
}

interface BiginDeal {
  id: string;
  Deal_Name: string;
  Stage: string;
  Contact_Name?: { name: string; id: string } | null;
  Phone?: string;
  Email?: string;
  Amount?: number;
  Closing_Date?: string;
  Description?: string;
  Modified_Time?: string;
  Address?: string;
}

interface BiginTask {
  id: string;
  Subject: string;
  Status: string;
  Priority: string;
  Due_Date?: string;
  Description?: string;
  What_Id?: { name: string; id: string } | null;
  Modified_Time?: string;
}

interface BiginContact {
  id: string;
  Full_Name: string;
  First_Name?: string;
  Last_Name?: string;
  Phone?: string;
  Mobile?: string;
  Email?: string;
  Mailing_Street?: string;
  Mailing_City?: string;
  Mailing_State?: string;
}

/**
 * Sync pipeline records (deals) from Bigin.
 * Maps deal stages to Joy task categories and creates/updates tasks.
 */
export async function syncDeals(): Promise<number> {
  let synced = 0;

  try {
    // Fetch deals modified since last sync (or all if first sync)
    const [state] = await db
      .select()
      .from(integrationState)
      .where(eq(integrationState.provider, "bigin"));

    let endpoint = "/Deals?fields=Deal_Name,Stage,Contact_Name,Phone,Email,Amount,Closing_Date,Description,Modified_Time,Address&per_page=100";

    if (state?.syncCursor) {
      endpoint += `&modified_since=${state.syncCursor}`;
    }

    const res = await biginFetch(endpoint);

    if (!res.ok) {
      if (res.status === 304) return 0; // No changes
      const text = await res.text();
      console.error("[bigin] Deals fetch failed:", res.status, text);
      return 0;
    }

    const data = await res.json();
    const deals: BiginDeal[] = data.data || [];

    for (const deal of deals) {
      const category = STAGE_TO_CATEGORY[deal.Stage] || "other";
      const priority = STAGE_TO_PRIORITY[deal.Stage] || "medium";
      const contactName = deal.Contact_Name?.name || undefined;

      // Check if we already track this deal
      const [existing] = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.externalId, deal.id),
            eq(tasks.externalSource, "bigin")
          )
        );

      if (existing) {
        // Update existing task
        await db
          .update(tasks)
          .set({
            title: `${deal.Stage}: ${deal.Deal_Name}`,
            category: category as "appointment" | "follow_up" | "admin" | "other",
            priority: priority as "urgent" | "high" | "medium" | "low",
            contactName,
            contactPhone: deal.Phone || existing.contactPhone,
            location: deal.Address || existing.location,
            description: deal.Description || existing.description,
            deadline: deal.Closing_Date
              ? new Date(deal.Closing_Date)
              : existing.deadline,
            metadata: {
              ...(existing.metadata as Record<string, unknown> || {}),
              biginStage: deal.Stage,
              biginAmount: deal.Amount,
              biginDealId: deal.id,
            },
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, existing.id));
      } else {
        // Create new task from deal
        // Skip closed deals for initial import
        if (deal.Stage === "Closed Won" || deal.Stage === "Closed Lost") {
          continue;
        }

        await db.insert(tasks).values({
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
            biginDealId: deal.id,
          },
        });
        synced++;
      }
    }
  } catch (err) {
    console.error("[bigin] Deal sync error:", err);
  }

  return synced;
}

/**
 * Sync tasks from Bigin (separate from deals — these are Bigin's own tasks)
 */
export async function syncBiginTasks(): Promise<number> {
  let synced = 0;

  try {
    const res = await biginFetch(
      "/Tasks?fields=Subject,Status,Priority,Due_Date,Description,What_Id,Modified_Time&per_page=100"
    );

    if (!res.ok) {
      if (res.status === 304) return 0;
      return 0;
    }

    const data = await res.json();
    const biginTasks: BiginTask[] = data.data || [];

    for (const bt of biginTasks) {
      // Skip completed Bigin tasks
      if (bt.Status === "Completed") continue;

      const externalId = `task_${bt.id}`;

      const [existing] = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.externalId, externalId),
            eq(tasks.externalSource, "bigin")
          )
        );

      const priority =
        bt.Priority === "High"
          ? "high"
          : bt.Priority === "Highest"
          ? "urgent"
          : bt.Priority === "Low"
          ? "low"
          : "medium";

      if (existing) {
        await db
          .update(tasks)
          .set({
            title: bt.Subject,
            priority: priority as "urgent" | "high" | "medium" | "low",
            deadline: bt.Due_Date ? new Date(bt.Due_Date) : existing.deadline,
            description: bt.Description || existing.description,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, existing.id));
      } else {
        await db.insert(tasks).values({
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
        synced++;
      }
    }
  } catch (err) {
    console.error("[bigin] Task sync error:", err);
  }

  return synced;
}

/**
 * Sync contacts from Bigin — updates contact info on existing tasks
 */
export async function syncContacts(): Promise<number> {
  let updated = 0;

  try {
    const res = await biginFetch(
      "/Contacts?fields=Full_Name,First_Name,Last_Name,Phone,Mobile,Email,Mailing_Street,Mailing_City,Mailing_State&per_page=100"
    );

    if (!res.ok) {
      if (res.status === 304) return 0;
      return 0;
    }

    const data = await res.json();
    const contacts: BiginContact[] = data.data || [];

    // Update tasks that reference these contacts
    for (const contact of contacts) {
      const phone = contact.Mobile || contact.Phone;
      const location = [
        contact.Mailing_Street,
        contact.Mailing_City,
        contact.Mailing_State,
      ]
        .filter(Boolean)
        .join(", ");

      if (!phone && !location) continue;

      // Find tasks linked to this contact by name
      const matchingTasks = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.externalSource, "bigin"),
            eq(tasks.contactName, contact.Full_Name)
          )
        );

      for (const task of matchingTasks) {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (phone && !task.contactPhone) updates.contactPhone = phone;
        if (location && !task.location) updates.location = location;

        if (Object.keys(updates).length > 1) {
          await db.update(tasks).set(updates).where(eq(tasks.id, task.id));
          updated++;
        }
      }
    }
  } catch (err) {
    console.error("[bigin] Contact sync error:", err);
  }

  return updated;
}

/**
 * Full Bigin sync: deals + tasks + contacts
 */
export async function fullSync(): Promise<{
  deals: number;
  tasks: number;
  contacts: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let dealCount = 0;
  let taskCount = 0;
  let contactCount = 0;

  try {
    dealCount = await syncDeals();
  } catch (err) {
    errors.push(`Deals: ${err instanceof Error ? err.message : "failed"}`);
  }

  try {
    taskCount = await syncBiginTasks();
  } catch (err) {
    errors.push(`Tasks: ${err instanceof Error ? err.message : "failed"}`);
  }

  try {
    contactCount = await syncContacts();
  } catch (err) {
    errors.push(`Contacts: ${err instanceof Error ? err.message : "failed"}`);
  }

  // Update last sync timestamp and sync cursor
  await db
    .update(integrationState)
    .set({
      lastSyncAt: new Date(),
      syncCursor: new Date().toISOString(),
      updatedAt: new Date(),
    })
    .where(eq(integrationState.provider, "bigin"));

  console.log(
    `[bigin] Sync complete: ${dealCount} deals, ${taskCount} tasks, ${contactCount} contacts, ${errors.length} errors`
  );

  return {
    deals: dealCount,
    tasks: taskCount,
    contacts: contactCount,
    errors,
  };
}

/**
 * Handle a Bigin webhook notification (optional real-time updates)
 */
export async function handleWebhook(payload: Record<string, unknown>): Promise<void> {
  const module = payload.module as string;
  const operation = payload.operation as string;

  console.log(`[bigin] Webhook: ${module} ${operation}`);

  // On any deal or task change, trigger a sync
  if (module === "Deals" || module === "Tasks") {
    await fullSync();
  }
}
