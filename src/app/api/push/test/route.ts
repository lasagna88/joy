import { NextResponse } from "next/server";
import { sendPushNotification } from "@/lib/notifications";

export async function POST() {
  try {
    await sendPushNotification({
      title: "Test Notification",
      body: "If you see this, push notifications are working!",
      url: "/",
      type: "test",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Test notification error:", error);
    return NextResponse.json(
      { error: "Failed to send test notification" },
      { status: 500 }
    );
  }
}
