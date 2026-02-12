import webPush from "web-push";
import { db } from "@/lib/db";
import { pushSubscriptions, notifications } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@papwa.app";

  if (publicKey && privateKey) {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  type?: string;
}

export async function sendPushNotification(payload: PushPayload): Promise<void> {
  ensureVapid();

  if (!vapidConfigured) {
    console.warn("[push] VAPID keys not configured, skipping notification");
    return;
  }

  // Log the notification
  await db.insert(notifications).values({
    title: payload.title,
    body: payload.body,
    type: payload.type || "general",
    sentAt: new Date(),
  });

  // Get all subscriptions
  const subs = await db.select().from(pushSubscriptions);

  if (subs.length === 0) {
    console.log("[push] No subscriptions registered");
    return;
  }

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
  });

  // Send to all subscriptions
  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          message
        );
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          console.log(`[push] Removing expired subscription`);
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, sub.endpoint));
        }
        throw error;
      }
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  console.log(`[push] Sent: ${sent}, Failed: ${failed}`);
}
