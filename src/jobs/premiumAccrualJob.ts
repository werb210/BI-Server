import cron from "node-cron";
import { logger } from "../platform/logger";
import { runPremiumAccrual } from "../worker/accrual.worker";

export function startPremiumAccrualJob() {
  cron.schedule("0 2 * * *", async () => {
    logger.info("Running premium accrual job");
    await runPremiumAccrual();
  });
}
