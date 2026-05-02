import { Router } from "express";
import multer from "multer";
import { mayaScrapeFinancials } from "../services/mayaOcr";

const router = Router();
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/applications/:publicId/scrape", upload.single("file"), async (req, res) => {
  const f = (req as any).file;
  if (!f) return res.status(400).json({ error: "no_file" });
  try {
    const extracted = await mayaScrapeFinancials({
      buffer: f.buffer,
      mime: f.mimetype,
      filename: f.originalname,
    });
    return res.json({
      extracted,
      confidence: extracted._confidence ?? null,
      source_filename: f.originalname,
    });
  } catch (err: any) {
    return res.status(502).json({ error: "scrape_failed", detail: String(err?.message) });
  }
});

export default router;
