import cron from "node-cron";
import { logger } from "../platform/logger";
import { runPremiumAccrual } from "../worker/accrual.worker";

// v410: premium accrual is a post-launch financial feature whose schema
// (bi_jobs.job_type, double-entry bi_ledger, bi_commission_payables shapes)
// is not yet built. The worker targets columns that do not exist, so the
// daily cron fails every run. Gate scheduling behind ENABLE_PREMIUM_ACCRUAL
// until the real accrual schema lands; flip the env var to re-enable.
export function startPremiumAccrualJob() {
  if (process.env.ENABLE_PREMIUM_ACCRUAL !== "true") {
    logger.info("premium accrual job disabled (ENABLE_PREMIUM_ACCRUAL!=true) — schema not yet built");
    return;
  }
  cron.schedule("0 2 * * *", async () => {
    logger.info("Running premium accrual job");
    await runPremiumAccrual();
  });
}
