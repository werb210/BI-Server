// BI_SERVER_BLOCK_v332_INTERNALIZE_DOCS_REMINDER_CRON_v1
import cron from "node-cron";
import { logger } from "../platform/logger";
import { runDocsReminderCronTick } from "../routes/biJobs";

// 13:00 UTC Mon-Fri = 07:00 MT. Matches the schedule the previous
// .github/workflows/bi-docs-reminder.yml used so deliverability
// timing is identical.
const SCHEDULE = "0 13 * * 1-5";

export function startDocsReminderCronJob(): void {
  cron.schedule(SCHEDULE, async () => {
    try {
      const result = await runDocsReminderCronTick();
      logger.info({ ...result }, "docs_reminder_cron_tick_complete");
    } catch (err) {
      logger.error({ err }, "docs_reminder_cron_tick_threw");
    }
  });
  logger.info({ schedule: SCHEDULE }, "docs_reminder_cron_job_scheduled");
}
