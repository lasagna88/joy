import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { integrationState } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const SALESRABBIT_API_URL = "https://api.salesrabbit.com";

/**
 * GET /api/integrations/salesrabbit/leads — Diagnostic: fetch raw leads from SR API
 */
export async function GET() {
  try {
    const [state] = await db
      .select()
      .from(integrationState)
      .where(
        and(
          eq(integrationState.provider, "salesrabbit"),
          eq(integrationState.isActive, true)
        )
      );

    if (!state?.accessToken) {
      return NextResponse.json({ error: "SalesRabbit not connected" }, { status: 400 });
    }

    const config = (state.config as Record<string, unknown>) || {};
    const userId = config.userId as string | undefined;

    let endpoint = `${SALESRABBIT_API_URL}/leads?limit=100&sortDir=desc`;
    if (userId) {
      endpoint += `&userId=${userId}`;
    }

    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `SR API ${res.status}`, body: text }, { status: 502 });
    }

    const data = await res.json();
    const leads = data.data || data || [];

    // Return a summary of each lead with the fields we care about
    const summary = leads.map((lead: Record<string, unknown>) => ({
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      status: lead.status,
      statusName: lead.statusName,
      phone: lead.phone,
      email: lead.email,
      customFields: lead.customFields,
      createdDate: lead.createdDate,
      modifiedDate: lead.modifiedDate,
    }));

    return NextResponse.json({
      userId,
      totalLeads: leads.length,
      leads: summary,
    });
  } catch (error) {
    console.error("[api/salesrabbit/leads] Error:", error);
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
  }
}
