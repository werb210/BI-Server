import { env } from "../platform/env";
import { logger } from "../platform/logger";

export type ScrapedFinancials = Partial<{
  annual_revenue: number;
  ebitda: number;
  total_debt: number;
  monthly_debt_service: number;
  collateral_value: number;
  enterprise_value: number;
  _confidence: number;
}>;

export async function mayaScrapeFinancials(args: {
  buffer: Buffer;
  mime: string;
  filename: string;
}): Promise<ScrapedFinancials> {
  const url = (env.MAYA_URL || "").replace(/\/$/, "") + "/scrape/financials";
  if (!env.MAYA_URL) throw new Error("MAYA_URL not configured");

  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(args.buffer)], { type: args.mime }), args.filename);

  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MAYA_SERVICE_TOKEN ?? ""}` },
    body: fd as any,
  });
  if (!r.ok) {
    const text = await r.text();
    logger.error({ status: r.status, body: text }, "maya_scrape_failed");
    throw new Error(`maya scrape ${r.status}`);
  }
  return (await r.json()) as ScrapedFinancials;
}
