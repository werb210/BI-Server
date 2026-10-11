// BI_SERVER_v789_NO_ERR_MESSAGE - responses never carry err.message (it can
// hold SQL, table/column names, file paths or upstream bodies). The detail is
// logged server-side with the request id; the client gets the code and the id.
import { logger } from "./logger";

type ReqLike = { id?: unknown; method?: string; originalUrl?: string } | undefined;

/** Log the error with its code and return the request id to put in the response. */
export function logHiddenError(req: ReqLike, err: unknown, code: string): string | undefined {
  logger.error({ err, code, requestId: req?.id, method: req?.method, path: req?.originalUrl }, `request_failed:${code}`);
  return req?.id === undefined || req?.id === null ? undefined : String(req.id);
}
