import { Router } from "express";
import multer from "multer";
import { pool } from "../db";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) => done(null, /^image\/(?:png|jpe?g|gif|webp)$/i.test(file.mimetype)),
});

export const biMarketingEmailAssetUploadRouter: Router = Router();
export const biMarketingEmailAssetPublicRouter: Router = Router();

biMarketingEmailAssetUploadRouter.post("/email/assets/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { code: "image_required" } });
  const result = await pool.query(
    `INSERT INTO bi_email_assets(filename,content_type,content,created_by)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [req.file.originalname, req.file.mimetype, req.file.buffer, (req as any).user?.id || null],
  );
  const id = result.rows[0].id;
  // BI_SERVER_PUBLIC_ASSET_MOUNT_ORDER_v13 - the App Service setting is named
  // BI_PUBLIC_BASE_URL. This read PUBLIC_BASE_URL, which is not set, so every
  // upload took the fallback and baked the request-time host into a URL stored
  // permanently on the template.
  const base =
    process.env.BI_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get("host")}`;
  return res.status(201).json({ id, url: `${base}/api/v1/bi/marketing/email/assets/${id}` });
});

// BI_SERVER_ASSET_CORP_CROSS_ORIGIN_v19
// server.ts calls app.use(helmet()), and helmet's default sets
// Cross-Origin-Resource-Policy: same-origin on EVERY response. This route
// exists to be embedded cross-origin - by the composer preview iframe on
// staff.boreal.financial, and by Gmail/Apple Mail image proxies - so that
// default silently broke every marketing email image.
//
// The failure is invisible to every check that does not embed the image:
// opening the URL in a browser tab is a same-origin navigation, so CORP is not
// evaluated and the image renders. curl shows 200 image/png. Only an embedding
// context sees it, as ERR_BLOCKED_BY_RESPONSE.NotSameOrigin with status 200.
//
// Access-Control-Allow-Origin is included for image proxies that send an Origin
// header; an <img> is a no-CORS request, so CORP is the header that matters.
export const PUBLIC_ASSET_HEADERS: Record<string, string> = {
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=31536000, immutable",
};

biMarketingEmailAssetPublicRouter.get("/email/assets/:id", async (req, res) => {
  const result = await pool.query("SELECT content_type,content FROM bi_email_assets WHERE id=$1", [req.params.id]);
  if (!result.rowCount) return res.status(404).end();
  res.set({ ...PUBLIC_ASSET_HEADERS, "Content-Type": result.rows[0].content_type });
  return res.send(result.rows[0].content);
});
