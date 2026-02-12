import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { updateGoogleEvent, deleteGoogleEvent } from "@/lib/google-calendar";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.startTime) updates.startTime = new Date(body.startTime);
    if (body.endTime) updates.endTime = new Date(body.endTime);
    if (body.location !== undefined) updates.location = body.location;
    if (body.color) updates.color = body.color;
    if (body.isBlocker !== undefined) updates.isBlocker = body.isBlocker;

    const [event] = await db
      .update(calendarEvents)
      .set(updates)
      .where(eq(calendarEvents.id, id))
      .returning();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Sync update to Google Calendar if the event has been pushed
    if (event.googleEventId && event.source === "ai_planned") {
      updateGoogleEvent({
        id: event.id,
        googleEventId: event.googleEventId,
        title: event.title,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location,
      }).catch((err) => console.error("[api] Google Calendar update failed:", err));
    }

    return NextResponse.json({ event });
  } catch (error) {
    console.error("Failed to update event:", error);
    return NextResponse.json(
      { error: "Failed to update event" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [event] = await db
      .delete(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .returning();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Delete from Google Calendar if it was a Joy-created event (not a blocker)
    if (event.googleEventId && event.source === "ai_planned") {
      deleteGoogleEvent(event.googleEventId).catch((err) =>
        console.error("[api] Google Calendar delete failed:", err)
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete event:", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
