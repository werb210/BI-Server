import app, { bootstrap } from "./server";
import { env } from "./platform/env";
import { logger } from "./platform/logger";

logger.info("BI process start");
logger.info("BI init start");

bootstrap().catch((err) => {
  logger.error({ err }, "BI DB failed (non-blocking)");
});

const port = Number(env.PORT || "8080");

app.listen(port, () => {
  logger.info({ port }, "BI server running");
});
