// BI_SERVER_EMAIL_LOGO_v24
// Serve BI's own email wordmark instead of relying on BF-Server's branding.
// Mail image proxies require an explicitly cross-origin resource policy because
// helmet's default policy is same-origin.
import { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const BI_EMAIL_LOGO_FILENAME = "boreal_risk_management_email_logo_1200x300.png";

const router: Router = Router();

// TypeScript does not copy assets, so production builds place the image in
// dist/assets. The source candidates keep the route usable in local TS runs.
function loadLogo(): Buffer {
  const candidates = [
    join(__dirname, "..", "assets", BI_EMAIL_LOGO_FILENAME),
    join(__dirname, "..", "..", "src", BI_EMAIL_LOGO_FILENAME),
    join(process.cwd(), "src", BI_EMAIL_LOGO_FILENAME),
    join(process.cwd(), "dist", "assets", BI_EMAIL_LOGO_FILENAME),
  ];

  for (const path of candidates) {
    try {
      return readFileSync(path);
    } catch {
      // Try the next source or compiled asset location.
    }
  }
  throw new Error("BI email logo asset not found");
}

let cached: Buffer | null = null;

router.get("/public/email/logo.png", (_req, res) => {
  try {
    if (!cached) cached = loadLogo();
  } catch {
    return res.status(404).end();
  }

  res.set({
    "Content-Type": "image/png",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
  });
  return res.send(cached);
});

export default router;
