// BI_SERVER_PGI_CONSENT_GATE_v1 (2026-11-24) - PGI referral agreement s.9 (tell the client how Boreal Risk
// Management is paid, before the referral) and s.10 (express written consent before sharing with PGI).
// Nothing goes to PGI unless bi_applications.data.consent_evidence shows both. boreal.insure's own application
// and BF-Server's handoff record it at intake. Files a lender submits for a borrower don't carry it, so the
// guarantor gets an email with a link to confirm it themselves; the file is sent to PGI when they do.
import crypto from "node:crypto";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { sendBiMarketingEmail, sendgridConfigured } from "./biSendgridService";

export const PGI_CONSENT_VERSION = "2026-11-24";
const SITE = (process.env.BI_PUBLIC_SITE_URL || "https://www.boreal.insure").replace(/\/+$/, "");
const RESEND_AFTER_MS = 24 * 60 * 60 * 1000;

function brokerFor(country: string | null | undefined): string {
  return String(country ?? "").toUpperCase() === "US" ? "PGI America Ltd." : "PGI Canada Ltd.";
}

export function feeDisclosureText(country?: string | null): string {
  const b = brokerFor(country);
  return `Boreal Risk Management may receive a fee from ${b} if you buy coverage. We are not an insurance broker, agent, underwriter or representative of PGI. ${b} alone decides underwriting, pricing, eligibility and policy terms. You do not have to buy coverage to use our services, and it is never a condition of your loan.`;
}

export function consentText(country?: string | null): string {
  return `I consent to Boreal Risk Management sharing the information in this application, and the documents provided with it, with ${brokerFor(country)} for intake, eligibility review, underwriting, quote preparation, policy administration, compliance review and related communications.`;
}

/** The evidence object every intake path writes to data.consent_evidence. */
export function consentEvidence(input: {
  feeText?: string | null; consentText?: string | null; version?: string | null;
  ip?: string | null; userAgent?: string | null; via: string;
}) {
  return {
    fee_disclosure: { accepted: true, text: input.feeText ?? null, version: input.version ?? null },
    share_with_pgi: { accepted: true, text: input.consentText ?? null, version: input.version ?? null },
    at: new Date().toISOString(), ip: input.ip ?? null, user_agent: input.userAgent ? String(input.userAgent).slice(0, 300) : null,
    via: input.via,
  };
}

export async function hasPgiConsent(applicationId: string): Promise<boolean> {
  const r = await pool.query<{ ok: boolean | null }>(
    `SELECT (data->'consent_evidence'->'fee_disclosure'->>'accepted' = 'true'
             AND data->'consent_evidence'->'share_with_pgi'->>'accepted' = 'true') AS pgi_consent_ok
       FROM bi_applications WHERE id = $1`,
    [applicationId],
  );
  return (r.rows[0] as any)?.pgi_consent_ok === true;
}

export type ConsentResume = { path: "pgi" } | { path: "lender"; input: unknown };

/** Holds the file and emails the guarantor a consent link (at most once a day per file). */
export async function requestPgiConsent(applicationId: string, resume: ConsentResume): Promise<{ requested: boolean; emailed: boolean }> {
  const r = await pool.query<any>(
    `SELECT guarantor_name, COALESCE(guarantor_email, form_data->>'q7_email', form_data->>'guarantor_email') AS email,
            COALESCE(business_name, company_name) AS business, country, data->'consent_request' AS req
       FROM bi_applications WHERE id = $1`,
    [applicationId],
  );
  const row = r.rows[0];
  if (!row) return { requested: false, emailed: false };
  const prev = row.req && typeof row.req === "object" ? row.req : null;
  const token: string = prev?.token || crypto.randomBytes(24).toString("base64url");
  const lastSent = prev?.emailed_at ? Date.parse(prev.emailed_at) : 0;
  const shouldEmail = !!row.email && (!lastSent || Date.now() - lastSent > RESEND_AFTER_MS);
  const request = {
    token, resume, requested_at: prev?.requested_at || new Date().toISOString(),
    emailed_at: shouldEmail ? new Date().toISOString() : prev?.emailed_at ?? null,
  };
  await pool.query(
    `UPDATE bi_applications SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{consent_request}', $2::jsonb), updated_at = NOW() WHERE id = $1`,
    [applicationId, JSON.stringify(request)],
  );
  if (!shouldEmail) return { requested: true, emailed: false };
  if (!sendgridConfigured()) {
    logger.warn({ applicationId }, "pgi_consent_email_not_configured");
    return { requested: true, emailed: false };
  }
  const link = `${SITE}/consent/${token}`;
  const first = String(row.guarantor_name ?? "").trim().split(/\s+/)[0] || "there";
  const business = String(row.business ?? "your business");
  try {
    await sendBiMarketingEmail({
      to: row.email,
      transactional: true,
      subject: "Please confirm before we send your Personal Guarantee Insurance application",
      text: `Hi ${first},\n\nYour lender started a Personal Guarantee Insurance application for ${business}. Before anything is shared with ${brokerFor(row.country)}, we need you to read how Boreal Risk Management is paid and confirm you agree to the sharing.\n\nConfirm here: ${link}\n\nPersonal Guarantee Insurance is optional and is never a condition of your loan. If you don't want to go ahead, ignore this email and nothing will be sent.\n\nBoreal Risk Management`,
      html: `<p>Hi ${escapeHtml(first)},</p><p>Your lender started a Personal Guarantee Insurance application for ${escapeHtml(business)}. Before anything is shared with ${brokerFor(row.country)}, we need you to read how Boreal Risk Management is paid and confirm you agree to the sharing.</p><p><a href="${link}">Review and confirm</a></p><p>Personal Guarantee Insurance is optional and is never a condition of your loan. If you don't want to go ahead, ignore this email and nothing will be sent.</p><p>Boreal Risk Management</p>`,
      customArgs: { kind: "pgi_consent", application_id: applicationId },
    });
    return { requested: true, emailed: true };
  } catch (err) {
    logger.warn({ err, applicationId }, "pgi_consent_email_failed");
    return { requested: true, emailed: false };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** What the consent page shows. Null when the link is unknown. */
export async function getConsentRequest(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await pool.query<any>(
    `SELECT id, guarantor_name, COALESCE(business_name, company_name) AS business, country,
            (data->'consent_evidence'->'share_with_pgi'->>'accepted' = 'true') AS done
       FROM bi_applications WHERE data->'consent_request'->>'token' = $1 LIMIT 1`,
    [token],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    applicationId: String(row.id), guarantorName: row.guarantor_name ?? null, business: row.business ?? null,
    country: row.country ?? null, alreadyConfirmed: row.done === true,
    feeDisclosure: feeDisclosureText(row.country), consentText: consentText(row.country), version: PGI_CONSENT_VERSION,
  };
}

/** Records the guarantor's consent and sends the held file to PGI. */
export async function acceptConsent(token: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const req = await getConsentRequest(token);
  if (!req) return { ok: false as const, error: "not_found" };
  if (!req.alreadyConfirmed) {
    const evidence = consentEvidence({
      feeText: req.feeDisclosure, consentText: req.consentText, version: req.version,
      ip: meta.ip, userAgent: meta.userAgent, via: "guarantor_link",
    });
    await pool.query(
      `UPDATE bi_applications SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{consent_evidence}', $2::jsonb), updated_at = NOW() WHERE id = $1`,
      [req.applicationId, JSON.stringify(evidence)],
    );
  }
  const r = await pool.query<any>(`SELECT data->'consent_request'->'resume' AS resume FROM bi_applications WHERE id = $1`, [req.applicationId]);
  const resume = r.rows[0]?.resume as ConsentResume | undefined;
  try {
    if (resume?.path === "lender") {
      const { submitLenderApplicationToCarrier } = await import("./lenderCarrierSubmit");
      await submitLenderApplicationToCarrier(resume.input as any);
    } else if (resume?.path === "pgi") {
      const { submitApplicationToPGI } = await import("./biPgiSubmissionService");
      await submitApplicationToPGI(req.applicationId);
    }
  } catch (err) {
    // Consent is kept; staff can resend the file from the application card.
    logger.warn({ err, applicationId: req.applicationId }, "pgi_consent_resume_failed");
  }
  return { ok: true as const };
}
