import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

import { pool } from "../db";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

const uploadDir = path.join(__dirname, "../../uploads/pgi");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage });

type LoanType = "secured" | "unsecured";

type PgiApplication = {
  applicationId: string;
  companyName: string;
  loanAmount: number;
  loanType: LoanType;
  coveragePercent: number;
  applicant: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  referrerId: string | null;
  lenderId: string | null;
  status: string;
  stage: string;
  quote: {
    insuredAmount: number;
    premium: number;
    rate: number;
    maxCoverage: number;
  };
  documents: Array<{
    documentId: string;
    filename: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
  }>;
  timeline: Array<{ stage: string; timestamp: string }>;
  createdAt: string;
};

const PIPELINE_STAGES = [
  "Quote Created",
  "Application Started",
  "Application Submitted",
  "Under Review",
  "Approved",
  "Policy Issued",
  "Declined"
] as const;

function normalizeCoveragePercent(coveragePercent: number): number {
  if (coveragePercent > 1) {
    return coveragePercent / 100;
  }

  return coveragePercent;
}

function computeQuote(loanAmount: number, coveragePercentInput: number, loanType: LoanType) {
  const normalizedCoverage = normalizeCoveragePercent(coveragePercentInput);
  const cappedCoverage = Math.min(normalizedCoverage, 0.8);
  const insuredAmount = loanAmount * cappedCoverage;
  const rate = loanType === "secured" ? 0.016 : 0.04;
  const premium = insuredAmount * rate;

  return {
    insuredAmount,
    premium,
    rate,
    maxCoverage: 0.8
  };
}

async function ensureSupportTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pgi_referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      crm_contact_id TEXT,
      commission_eligible BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pgi_crm_contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

router.get("/health", (_req, res) => {
  return ok(res, {
    status: "ok",
    service: "bi-server",
    timestamp: new Date().toISOString()
  });
});

router.post("/quote", (req, res) => {
  const { loanAmount, coveragePercent, loanType } = req.body as {
    loanAmount?: number;
    coveragePercent?: number;
    loanType?: LoanType;
  };

  if (!loanAmount || !coveragePercent || !loanType || !["secured", "unsecured"].includes(loanType)) {
    return badRequest(res, "Invalid quote request");
  }

  return ok(res, computeQuote(loanAmount, coveragePercent, loanType));
});

router.post("/applications", async (req, res) => {
  const payload = req.body as Omit<PgiApplication, "applicationId" | "status" | "stage" | "quote" | "documents" | "timeline" | "createdAt">;

  if (!payload?.companyName || !payload?.loanAmount || !payload?.loanType || !payload?.coveragePercent || !payload?.applicant?.email) {
    return badRequest(res, "Invalid application payload");
  }

  const applicationId = randomUUID();
  const createdAt = new Date().toISOString();
  const quote = computeQuote(payload.loanAmount, payload.coveragePercent, payload.loanType);

  const application: PgiApplication = {
    applicationId,
    companyName: payload.companyName,
    loanAmount: payload.loanAmount,
    loanType: payload.loanType,
    coveragePercent: payload.coveragePercent,
    applicant: payload.applicant,
    referrerId: payload.referrerId ?? null,
    lenderId: payload.lenderId ?? null,
    status: "Application Started",
    stage: "Application Started",
    quote,
    documents: [],
    timeline: [{ stage: "Application Started", timestamp: createdAt }],
    createdAt
  };

  await pool.query("INSERT INTO pgi_applications(id, data) VALUES($1, $2)", [applicationId, application]);

  return ok(res, {
    applicationId,
    status: "Application Started"
  });
});

router.get("/applications/:id", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query("SELECT data FROM pgi_applications WHERE id=$1", [id]);

  if (result.rows.length === 0) {
    return badRequest(res, "Application not found");
  }

  return ok(res, result.rows[0].data);
});

router.post("/applications/:id/documents", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const file = req.file;

  if (!file) {
    return badRequest(res, "File is required");
  }

  const result = await pool.query("SELECT data FROM pgi_applications WHERE id=$1", [id]);

  if (result.rows.length === 0) {
    return badRequest(res, "Application not found");
  }

  const data = result.rows[0].data as PgiApplication;
  const document = {
    documentId: randomUUID(),
    filename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date().toISOString()
  };

  data.documents = [...(data.documents ?? []), document];
  data.timeline = [...(data.timeline ?? []), { stage: "Document Uploaded", timestamp: new Date().toISOString() }];

  await pool.query("UPDATE pgi_applications SET data=$2 WHERE id=$1", [id, data]);

  return ok(res, {
    documentId: document.documentId,
    status: "uploaded"
  });
});

router.get("/applications/:id/documents", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query("SELECT data FROM pgi_applications WHERE id=$1", [id]);

  if (result.rows.length === 0) {
    return badRequest(res, "Application not found");
  }

  const data = result.rows[0].data as PgiApplication;

  return ok(res, data.documents ?? []);
});

router.get("/pipeline/lender/:lenderId", async (req, res) => {
  const { lenderId } = req.params;
  const result = await pool.query("SELECT id, data FROM pgi_applications");

  const rows = result.rows
    .map((row) => row.data as PgiApplication)
    .filter((app) => app.lenderId === lenderId)
    .map((app) => ({
      applicationId: app.applicationId,
      companyName: app.companyName,
      stage: app.stage,
      loanAmount: app.loanAmount
    }));

  return ok(res, rows);
});

router.post("/referrals", async (req, res) => {
  const { company, firstName, lastName, email, phone } = req.body;

  if (!company || !firstName || !lastName || !email || !phone) {
    return badRequest(res, "Invalid referral payload");
  }

  await ensureSupportTables();

  const crmResult = await pool.query(
    `INSERT INTO pgi_crm_contacts(name,email,phone,tags)
     VALUES($1,$2,$3,$4::jsonb)
     RETURNING id`,
    [`${firstName} ${lastName}`, email, phone, JSON.stringify(["BI_REFERRAL"])]
  );

  await pool.query(
    `INSERT INTO pgi_referrals(company, first_name, last_name, email, phone, crm_contact_id, commission_eligible)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [company, firstName, lastName, email, phone, crmResult.rows[0].id, true]
  );

  return ok(res, { status: "created" });
});

router.post("/referrer/login", (_req, res) => {
  return ok(res, { status: "sent", challenge: "000000" });
});

router.post("/referrer/verify", (req, res) => {
  const { code } = req.body;

  if (code !== "000000") {
    return badRequest(res, "Invalid code");
  }

  return ok(res, { status: "verified" });
});

router.post("/lender/login", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return badRequest(res, "Email required");
  }

  return ok(res, {
    lenderId: randomUUID(),
    status: "authenticated"
  });
});

router.get("/lender/dashboard/:lenderId", async (req, res) => {
  const { lenderId } = req.params;
  const result = await pool.query("SELECT data FROM pgi_applications");

  const applications = result.rows.map((row) => row.data as PgiApplication).filter((app) => app.lenderId === lenderId);
  const pipeline = applications.map((app) => ({
    applicationId: app.applicationId,
    companyName: app.companyName,
    stage: app.stage,
    loanAmount: app.loanAmount
  }));

  return ok(res, { applications, pipeline });
});

router.post("/crm/contact", async (req, res) => {
  const { name, email, phone, tags } = req.body;

  if (!name || !email) {
    return badRequest(res, "name and email are required");
  }

  await ensureSupportTables();

  await pool.query(
    `INSERT INTO pgi_crm_contacts(name,email,phone,tags)
     VALUES($1,$2,$3,$4::jsonb)`,
    [name, email, phone ?? null, JSON.stringify(tags ?? [])]
  );

  return ok(res, { status: "created" });
});

router.post("/crm/application", async (req, res) => {
  const payload = req.body;

  await pool.query("INSERT INTO pgi_applications(data) VALUES($1)", [payload]);

  return ok(res, { status: "created" });
});

router.post("/external/pgi/submit", async (req, res) => {
  const payload = req.body;
  const transformed = {
    ...payload,
    forwardedAt: new Date().toISOString(),
    provider: "purbeck-pgi"
  };

  const responseStub = {
    providerSubmissionId: randomUUID(),
    status: "received"
  };

  await pool.query("INSERT INTO pgi_applications(data) VALUES($1)", [{ source: "external_submit", transformed, responseStub }]);

  return ok(res, {
    status: "submitted",
    response: responseStub
  });
});

router.get("/admin/applications", async (_req, res) => {
  const result = await pool.query("SELECT id, data, created_at FROM pgi_applications ORDER BY created_at DESC");

  return ok(res, result.rows);
});

router.get("/admin/pipeline", async (_req, res) => {
  const result = await pool.query("SELECT data FROM pgi_applications ORDER BY created_at DESC");

  const pipeline = result.rows
    .map((row) => row.data as Partial<PgiApplication>)
    .filter((app) => typeof app.applicationId === "string")
    .map((app) => ({
      applicationId: app.applicationId,
      companyName: app.companyName,
      stage: app.stage,
      loanAmount: app.loanAmount
    }));

  return ok(res, {
    stages: PIPELINE_STAGES,
    applications: pipeline
  });
});

export default router;
