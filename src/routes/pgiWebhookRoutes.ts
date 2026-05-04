import crypto from "crypto";
import express from "express";
import { pool } from "../db";
import { env } from "../platform/env";
import { onApplicationApproved } from "../services/pgiOnApprovedHook";

const router = express.Router();
function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.PGI_WEBHOOK_SECRET || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", env.PGI_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let receivedBuf: Buffer;
  try { receivedBuf = Buffer.from(signatureHeader, "hex"); } catch { return false; }
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

router.post("/api/v1/webhooks/pgi", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = req.header("X-PGI-Signature");
  if (!verifySignature(rawBody, signature)) return res.status(401).json({ error: "invalid_signature" });
  const evt = JSON.parse(rawBody.toString("utf8"));
  if (evt.event === "application.quoted") {
    const prev = await pool.query(`SELECT id, status FROM bi_applications WHERE pgi_application_id=$1 LIMIT 1`, [evt.application_id]);
    /* BI_SERVER_BLOCK_v62_STAGE_ALIGNMENT_v1 — quoted folds into under_review per
       Todd's locked pipeline spec. Quote data persists; only policy.bound
       triggers the actual approval. */
    await pool.query(`UPDATE bi_applications SET status='under_review', quote_id=$1, underwriter_ref=$2, annual_premium=$3, quote_valid_until=$4, updated_at=NOW() WHERE pgi_application_id=$5`, [evt.quote_id, evt.underwriter_ref, evt.annual_premium, evt.valid_until, evt.application_id]);
    // BI_SERVER_BLOCK_v62_STAGE_ALIGNMENT_v1 — onApplicationApproved no
    // longer fires on .quoted (quote != approval per locked spec). It now
    // fires only on policy.bound which is the actual approval signal.
    void prev;
  } else if (evt.event === "application.declined") {
    await pool.query(`UPDATE bi_applications SET status='declined', score_reason=$1, updated_at=NOW() WHERE pgi_application_id=$2`, [evt.reason ?? "PGI declined", evt.application_id]);
  } else if (evt.event === "application.information_required") {
    await pool.query(`UPDATE bi_applications SET status='information_required', updated_at=NOW() WHERE pgi_application_id=$1`, [evt.application_id]);
  }
  res.json({ ok: true });
});

export default router;
