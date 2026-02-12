import "dotenv/config";
import { Worker, Queue } from "bullmq";
import Redis from "ioredis";
import { runMorningBriefing } from "./jobs/morning-briefing";
import { runEveningReview } from "./jobs/evening-review";
import { runWeeklyPlan } from "./jobs/weekly-plan";
import { runGoogleCalendarSync } from "./jobs/google-calendar-sync";
import { runBiginSync } from "./jobs/bigin-sync";
import { runSalesRabbitSync } from "./jobs/salesrabbit-sync";
import { runGroceryCleanup } from "./jobs/grocery-cleanup";
import { sendPushNotification } from "../lib/notifications";

const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Define queues
const planningQueue = new Queue("planning", { connection });
const notificationQueue = new Queue("notification", { connection });
const syncQueue = new Queue("sync", { connection });

// Planning worker
const planningWorker = new Worker(
  "planning",
  async (job) => {
    console.log(`[planning] Processing: ${job.name}`);

    switch (job.name) {
      case "morning-briefing":
        return await runMorningBriefing();
      case "evening-review":
        return await runEveningReview();
      case "weekly-plan":
        return await runWeeklyPlan();
      case "replan": {
        // On-demand replan for a specific date
        const { date } = job.data || {};
        console.log(`[planning] Replanning ${date || "today"}`);
        return await runMorningBriefing(); // Reuses morning briefing logic
      }
      default:
        console.log(`[planning] Unknown job: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 1, // Only one planning job at a time
  }
);

// Notification worker
const notificationWorker = new Worker(
  "notification",
  async (job) => {
    console.log(`[notification] Processing: ${job.name}`);

    const { title, body, url, type } = job.data;
    await sendPushNotification({ title, body, url, type });
  },
  { connection }
);

// Sync worker
const syncWorker = new Worker(
  "sync",
  async (job) => {
    console.log(`[sync] Processing: ${job.name}`);

    switch (job.name) {
      case "google-calendar-sync":
        return await runGoogleCalendarSync();
      case "bigin-sync":
        return await runBiginSync();
      case "salesrabbit-sync":
        return await runSalesRabbitSync();
      case "grocery-cleanup":
        return await runGroceryCleanup();
      default:
        console.log(`[sync] Unknown job: ${job.name}`);
    }
  },
  { connection }
);

// Set up repeatable schedules
async function setupSchedules() {
  // Clear existing repeatable jobs to avoid duplicates
  const existing = await planningQueue.getRepeatableJobs();
  for (const job of existing) {
    await planningQueue.removeRepeatableByKey(job.key);
  }

  const existingSync = await syncQueue.getRepeatableJobs();
  for (const job of existingSync) {
    await syncQueue.removeRepeatableByKey(job.key);
  }

  // Morning briefing: 6:00 AM daily
  await planningQueue.add(
    "morning-briefing",
    {},
    {
      repeat: {
        pattern: "0 6 * * *", // 6:00 AM
      },
    }
  );
  console.log("[scheduler] Morning briefing scheduled: 6:00 AM daily");

  // Evening review: 8:00 PM daily
  await planningQueue.add(
    "evening-review",
    {},
    {
      repeat: {
        pattern: "0 20 * * *", // 8:00 PM
      },
    }
  );
  console.log("[scheduler] Evening review scheduled: 8:00 PM daily");

  // Weekly planning: Sunday 6:00 PM
  await planningQueue.add(
    "weekly-plan",
    {},
    {
      repeat: {
        pattern: "0 18 * * 0", // Sunday 6:00 PM
      },
    }
  );
  console.log("[scheduler] Weekly planning scheduled: Sunday 6:00 PM");

  // Google Calendar sync: every 30 minutes
  await syncQueue.add(
    "google-calendar-sync",
    {},
    {
      repeat: {
        pattern: "*/30 * * * *", // Every 30 minutes
      },
    }
  );
  console.log("[scheduler] Google Calendar sync scheduled: every 30 minutes");

  // Bigin sync: every 15 minutes
  await syncQueue.add(
    "bigin-sync",
    {},
    {
      repeat: {
        pattern: "*/15 * * * *", // Every 15 minutes
      },
    }
  );
  console.log("[scheduler] Bigin sync scheduled: every 15 minutes");

  // SalesRabbit sync: every 15 minutes
  await syncQueue.add(
    "salesrabbit-sync",
    {},
    {
      repeat: {
        pattern: "7,22,37,52 * * * *", // Every 15 min, offset from Bigin
      },
    }
  );
  console.log("[scheduler] SalesRabbit sync scheduled: every 15 minutes (offset)");

  // Grocery cleanup: every hour
  await syncQueue.add(
    "grocery-cleanup",
    {},
    {
      repeat: {
        pattern: "45 * * * *", // Every hour at :45
      },
    }
  );
  console.log("[scheduler] Grocery cleanup scheduled: hourly");
}

// Graceful shutdown
async function shutdown() {
  console.log("[worker] Shutting down...");
  await Promise.all([
    planningWorker.close(),
    notificationWorker.close(),
    syncWorker.close(),
  ]);
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Worker event logging
for (const worker of [planningWorker, notificationWorker, syncWorker]) {
  worker.on("completed", (job) => {
    console.log(`[${worker.name}] Job ${job.name} (${job.id}) completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[${worker.name}] Job ${job?.name} (${job?.id}) failed:`, err.message);
  });
}

// Start
setupSchedules()
  .then(() => {
    console.log("[worker] Joy worker started. Listening for jobs...");
  })
  .catch((err) => {
    console.error("[worker] Failed to set up schedules:", err);
  });
