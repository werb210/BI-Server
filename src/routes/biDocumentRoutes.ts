import { Router } from "express";
import multer from "multer";
import { Pool } from "pg";
import path from "path";
import fs from "fs";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const uploadDir = path.join(__dirname, "../../uploads/bi");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${file.originalname}`;
    cb(null, unique);
  }
});

const upload = multer({ storage });

/* =========================
   DOCUMENT UPLOAD
========================= */
router.post("/application/:id/documents", upload.array("files"), async (req, res) => {
  const { id } = req.params;
  const files = (req.files as Express.Multer.File[]) ?? [];

  for (const file of files) {
    await pool.query(
      `
        INSERT INTO bi_documents
        (application_id, doc_type, original_filename, storage_key, mime_type, bytes, uploaded_by_actor)
        VALUES($1,'loan_agreement_signed',$2,$3,$4,$5,'applicant')
      `,
      [id, file.originalname, file.filename, file.mimetype, file.size]
    );

    await pool.query(
      `
        INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
        VALUES($1,'applicant','document_uploaded',$2)
      `,
      [id, `Document uploaded: ${file.originalname}`]
    );
  }

  res.json({ success: true });
});

export default router;
