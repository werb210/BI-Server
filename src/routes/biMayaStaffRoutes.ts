// BI_SERVER_BLOCK_v250_MAYA_STAFF_PIPELINE_QUERY_v1
// BI-side Maya endpoint. Mirrors BF-Server v214's contract:
//   POST /api/v1/bi/maya/staff/pipeline-query
//   Auth: service JWT (kind=service, source=maya-service|agent)
//   Body: { question: string, session_id?: string, user_id?: string }
//   Response: { ok, query?, rows?, summary?, not_supported?, supported_queries? }
import express, { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";
import { runBiPipelineQuery } from "../services/biMayaPipelineQuery";
// BI_SERVER_MAYA_F_PGI_READINESS_v1 — canonical PGI doc list + startup logic.
import {
  BI_DOC_REQUIREMENTS,
  requiredSlotsFor,
  carrierBoundSlots,
  isStartup,
} from "../lib/biDocumentRequirements";

const router = express.Router();

function getSecret(): string {
  return (env.JWT_SECRET as string | undefined) || process.env.JWT_SECRET || "";
}

function verifyMayaService(req: Request): { source: string } | null {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const p = jwt.verify(m[1], secret) as { kind?: string; source?: string };
    if (p?.kind !== "service") return null;
    if (p.source !== "maya-service" && p.source !== "agent") return null;
    return { source: String(p.source) };
  } catch {
    return null;
  }
}

async function audit(opts: {
  tool: string;
  args: unknown;
  ok: boolean;
  summary: string;
  errorCode?: string;
  source?: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bi_maya_audit
         (id, audience, service_source, tool, args_redacted, result_summary, ok, error_code)
       VALUES ($1,'staff',$2,$3,$4::jsonb,$5,$6,$7)`,
      [
        randomUUID(),
        opts.source ?? null,
        opts.tool,
        JSON.stringify(opts.args ?? null),
        opts.summary.slice(0, 500),
        opts.ok,
        opts.errorCode ?? null,
      ],
    );
  } catch (e: any) {
    logger.error({ err: e, tool: opts.tool }, "bi_maya_audit_insert_failed");
  }
}

router.post("/maya/staff/pipeline-query", async (req: Request, res: Response) => {
  const svc = verifyMayaService(req);
  if (!svc) return res.status(401).json({ ok: false, error: "service_jwt_required" });
  const question = typeof req.body?.question === "string" ? req.body.question : "";
  if (!question.trim()) {
    return res.status(400).json({ ok: false, error: "question_required" });
  }
  try {
    const result = await runBiPipelineQuery(question);
    await audit({
      tool: "pipeline.query",
      args: { question },
      ok: !!result.ok,
      summary: result.summary ?? "",
      source: svc.source,
    });
    return res.json(result);
  } catch (e: any) {
    await audit({
      tool: "pipeline.query",
      args: { question },
      ok: false,
      summary: e?.message ?? "error",
      errorCode: "bi_pipeline_query_exception",
      source: svc.source,
    });
    logger.error({ err: e }, "bi_maya_pipeline_query_failed");
    return res.status(500).json({ ok: false, error: "pipeline_query_failed" });
  }
});

// BI_SERVER_MAYA_F_PGI_READINESS_v1
// Read-only PGI document status + carrier-submission readiness for a BI
// application. Mirrors the BF-Server underwriting-summary / match-explain
// contract (decision F). Accepts either the BI public_id or the BI uuid
// (or a BF application's bi_public_id passed through by BF-Server). Never
// mutates state — staff accept/reject + carrier submit stay in their own
// gated paths.
router.post("/maya/staff/pgi-readiness", async (req: Request, res: Response) => {
  const svc = verifyMayaService(req);
  if (!svc) return res.status(401).json({ ok: false, error: "service_jwt_required" });

  const publicId = typeof req.body?.public_id === "string" ? req.body.public_id.trim() : "";
  const appId = typeof req.body?.application_id === "string" ? req.body.application_id.trim() : "";
  const ident = publicId || appId;
  if (!ident) {
    await audit({ tool: "pgi.readiness", args: { public_id: publicId, application_id: appId }, ok: false, summary: "identifier required", errorCode: "validation_error", source: svc.source });
    return res.status(400).json({ ok: false, error: "public_id_or_application_id_required" });
  }

  try {
    const ar = await pool.query<{
      id: string;
      public_id: string | null;
      stage: string | null;
      formation_date: string | null;
      pgi_application_id: string | null;
      pgi_external_id: string | null;
      submission_locked: boolean | null;
      company_name: string | null;
      created_at: string;
    }>(
      `SELECT id::text AS id, public_id, stage::text AS stage,
              formation_date, pgi_application_id, pgi_external_id, submission_locked,
              COALESCE(company_name, business_name) AS company_name, created_at
         FROM bi_applications
        WHERE public_id = $1 OR id::text = $1
        LIMIT 1`,
      [ident],
    );
    const app = ar.rows[0];
    if (!app) {
      await audit({ tool: "pgi.readiness", args: { ident }, ok: false, summary: "not_found", errorCode: "not_found", source: svc.source });
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const formation = app.formation_date ? new Date(app.formation_date).toISOString() : null;
    const startup = isStartup(formation);
    const requiredSlots = requiredSlotsFor(formation);
    const carrierBound = new Set<string>(carrierBoundSlots(formation));

    // Latest review state per slot. Slot vocabulary lives in doc_slot when
    // present, else the doc_type enum value (they share the same names).
    const dr = await pool.query<{ slot: string; review_status: string }>(
      `SELECT COALESCE(doc_slot, doc_type::text) AS slot,
              COALESCE(review_status, 'pending') AS review_status
         FROM bi_documents
        WHERE application_id = $1 AND purged_at IS NULL`,
      [app.id],
    );
    const bySlot = new Map<string, { accepted: number; pending: number; rejected: number }>();
    for (const row of dr.rows) {
      const slot = String(row.slot);
      const cur = bySlot.get(slot) ?? { accepted: 0, pending: 0, rejected: 0 };
      if (row.review_status === "accepted") cur.accepted += 1;
      else if (row.review_status === "rejected") cur.rejected += 1;
      else cur.pending += 1;
      bySlot.set(slot, cur);
    }
    const slotState = (slot: string): "accepted" | "pending" | "rejected" | "missing" => {
      const c = bySlot.get(slot);
      if (!c) return "missing";
      if (c.accepted > 0) return "accepted";
      if (c.pending > 0) return "pending";
      if (c.rejected > 0) return "rejected";
      return "missing";
    };

    const docs = requiredSlots.map((slot) => {
      const reqDef = BI_DOC_REQUIREMENTS.find((r) => r.slot === slot);
      return {
        slot,
        label: reqDef?.label ?? slot,
        carrierBound: carrierBound.has(slot),
        state: slotState(slot),
      };
    });
    const missing = docs.filter((d) => d.state === "missing").map((d) => d.slot);
    const pending = docs.filter((d) => d.state === "pending").map((d) => d.slot);
    const rejected = docs.filter((d) => d.state === "rejected").map((d) => d.slot);
    const acceptedCount = docs.filter((d) => d.state === "accepted").length;
    const allRequiredAccepted = docs.length > 0 && docs.every((d) => d.state === "accepted");

    const carrierSubmitted = Boolean(app.pgi_application_id || app.pgi_external_id);
    const submissionInFlight = app.submission_locked === true && !carrierSubmitted;
    const readyForCarrier = allRequiredAccepted && !carrierSubmitted && !submissionInFlight;

    const blockers: string[] = [];
    if (missing.length) blockers.push(`${missing.length} required document(s) not uploaded: ${missing.join(", ")}`);
    if (pending.length) blockers.push(`${pending.length} document(s) awaiting staff review: ${pending.join(", ")}`);
    if (rejected.length) blockers.push(`${rejected.length} document(s) rejected — need a replacement: ${rejected.join(", ")}`);
    if (carrierSubmitted) blockers.push("Already submitted to the PGI carrier.");
    else if (submissionInFlight) blockers.push("Carrier submission is currently in flight.");

    const result = {
      applicationId: app.id,
      publicId: app.public_id,
      companyName: app.company_name,
      stage: app.stage,
      isStartup: startup,
      formationDate: app.formation_date,
      docs,
      requiredTotal: docs.length,
      accepted: acceptedCount,
      missing,
      pending,
      rejected,
      allRequiredAccepted,
      carrier: {
        submitted: carrierSubmitted,
        inFlight: submissionInFlight,
        pgiApplicationId: app.pgi_application_id ?? null,
        pgiExternalId: app.pgi_external_id ?? null,
        readyForCarrier,
      },
      blockers,
      readOnly: true,
      lastActivityAt: app.created_at,
    };

    await audit({ tool: "pgi.readiness", args: { ident }, ok: true, summary: `missing=${missing.length} pending=${pending.length} accepted=${acceptedCount} ready=${readyForCarrier}`, source: svc.source });
    return res.json({ ok: true, result });
  } catch (e: any) {
    await audit({ tool: "pgi.readiness", args: { ident }, ok: false, summary: e?.message ?? "error", errorCode: "pgi_readiness_exception", source: svc.source });
    logger.error({ err: e }, "bi_maya_pgi_readiness_failed");
    return res.status(500).json({ ok: false, error: "pgi_readiness_failed" });
  }
});

export default router;
