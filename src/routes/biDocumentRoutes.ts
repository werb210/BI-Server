import { Router } from "express";
import multer from "multer";
import { Pool } from "pg";
import path from "path";
import fs from "fs";
import { env } from "../platform/env";
import { submitApplicationToPGI } from "../services/biPgiSubmissionService";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const pool = new Pool({ connectionString: env.DATABASE_URL });

const uploadDir = path.join(__dirname, "../../uploads/bi");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage });

router.post("/application/:id/documents", upload.array("files"), async (req, res) => {
  const { id } = req.params;
  const files = (req.files as Express.Multer.File[]) ?? [];
  const docTypesRaw = req.body?.doc_types;
  const docTypes = Array.isArray(docTypesRaw) ? docTypesRaw : typeof docTypesRaw === "string" ? [docTypesRaw] : [];
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const created: Array<{ id: string; fileUrl: string }> = [];

  for (const [idx, file] of files.entries()) {
    const docType = typeof docTypes[idx] === "string" && docTypes[idx].trim() ? docTypes[idx].trim() : "other";
    const inserted = await pool.query(
      `INSERT INTO bi_documents
      (application_id, doc_type, original_filename, storage_key, mime_type, bytes, uploaded_by_actor)
      VALUES($1,$2,$3,$4,$5,$6,'applicant')
      RETURNING id`,
      [id, docType, file.originalname, file.filename, file.mimetype, file.size]
    );

    const docId = inserted.rows[0].id as string;
    created.push({ id: docId, fileUrl: `${baseUrl}/api/v1/bi/documents/${docId}` });

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
       VALUES($1,'applicant','document_uploaded',$2)`,
      [id, `Document uploaded: ${file.originalname}`]
    );
  }

  let pgiResult: { externalId: string; status: string; alreadySubmitted: boolean } | null = null;
  try {
    pgiResult = await submitApplicationToPGI(id);
  } catch {
    pgiResult = null;
  }

  ok(res, { success: true, files: created, pgi: pgiResult });
});

router.get("/:id", async (req, res) => {
  const result = await pool.query(
    `SELECT original_filename, storage_key, mime_type FROM bi_documents WHERE id=$1 AND purged_at IS NULL LIMIT 1`,
    [req.params.id]
  );

  if (!result.rows.length) return badRequest(res, "Document not found");

  const row = result.rows[0] as { original_filename: string; storage_key: string; mime_type: string };
  const fullPath = path.join(uploadDir, row.storage_key);

  if (!fs.existsSync(fullPath)) return badRequest(res, "File missing");

  res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${row.original_filename}"`);

  return fs.createReadStream(fullPath).pipe(res);
});

export default router;
