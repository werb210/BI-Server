// BI_SERVER_v789 [5]/[37] - helpers for behaviour tests that exercise the REAL
// app from src/server.ts (instead of reading server.ts as text to check a
// mount line). The calling test file must mock the database first, e.g.
//
//   const queryMock = vi.fn();
//   vi.mock("../../db", () => ({
//     pool: { query: (...a: unknown[]) => queryMock(...a), connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }) },
//     runMigrations: async () => undefined,
//   }));
//
// then: const app = await realApp(); await fromBrowser(app, "get", "/api/v1/...").set(...)
import request from "supertest";
import type { Express } from "express";
import { signBiToken } from "../../platform/serviceTokens";

/** An origin on the exact-origin CORS allowlist (src/platform/corsOrigins.ts). */
export const ALLOWED_ORIGIN = "https://www.boreal.insure";

let ipCounter = 0;
/** A distinct public (TEST-NET-3) client IP per call, so per-IP limiters never answer 429. */
export function publicIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 250) + 1}`;
}

/** An applicant bearer, signed with the secret the app verifies with (process.env.JWT_SECRET). */
export function applicantBearer(phone: string): string {
  return `Bearer ${signBiToken({ kind: "applicant", phone }, "1h", String(process.env.JWT_SECRET))}`;
}

/** The real express app from src/server.ts (lazy, so the caller's vi.mock calls apply). */
export async function realApp(): Promise<Express> {
  const mod = await import("../../server");
  return mod.default as unknown as Express;
}

type Method = "get" | "post" | "put" | "patch" | "delete";

/** A request as the BI client in a browser sends it: allowed Origin, its own public IP. */
export function fromBrowser(app: Express, method: Method, path: string): request.Test {
  return request(app)[method](path).set("Origin", ALLOWED_ORIGIN).set("X-Forwarded-For", publicIp());
}
