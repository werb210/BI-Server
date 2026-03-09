import cron from "node-cron";
import { runPremiumAccrual } from "../worker/accrual.worker";

export function startPremiumAccrualJob() {

  cron.schedule("0 2 * * *", async () => {

    console.log("Running premium accrual job");

    await runPremiumAccrual();

  });

}
