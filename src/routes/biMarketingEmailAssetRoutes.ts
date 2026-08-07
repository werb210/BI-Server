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

biMarketingEmailAssetPublicRouter.get("/email/assets/:id", async (req, res) => {
  const result = await pool.query("SELECT content_type,content FROM bi_email_assets WHERE id=$1", [req.params.id]);
  if (!result.rowCount) return res.status(404).end();
  res.set({ "Content-Type": result.rows[0].content_type, "Cache-Control": "public, max-age=31536000, immutable" });
  return res.send(result.rows[0].content);
});
