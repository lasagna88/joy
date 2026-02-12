import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export async function runGroceryCleanup(): Promise<string> {
  const connectionString = process.env.DATABASE_URL!;
  const client = postgres(connectionString);
  const db = drizzle(client);

  try {
    const result = await db.execute(
      sql`DELETE FROM grocery_items WHERE checked = true AND checked_at < now() - interval '30 minutes'`
    );

    const count = result.length;
    console.log(`[grocery-cleanup] Removed ${count} checked items`);

    return `Cleaned up ${count} checked grocery items`;
  } finally {
    await client.end();
  }
}
