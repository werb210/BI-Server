// BI_SERVER_BLOCK_v559_CARRIER_CATALOGUE - staff "Send to carrier".
// Email the carrier if it has a submission address, else return its portal; record the send.
export type CarrierOption = {
  id: string; carrier: string; product_name: string; notes: string;
  instant_bind: boolean; submission_email: string | null; submission_url: string | null; verified: boolean;
};
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
export function buildCarrierEmail(input: {
  businessName: string; applicationCode: string | null; country: string; coverage: string;
  carrierProduct: string; limit: number | null; note: string | null; staffName: string | null;
}): { subject: string; html: string; text: string } {
  const limit = input.limit ? `$${Math.round(input.limit).toLocaleString("en-CA")}` : "to be confirmed";
  const rows: [string, string][] = [
    ["Business", input.businessName || "-"],
    ["Boreal reference", input.applicationCode || "-"],
    ["Country", input.country],
    ["Coverage requested", `${input.coverage} (${input.carrierProduct})`],
    ["Limit required by contract", limit],
  ];
  if (input.note) rows.push(["Broker note", input.note]);
  const subject = `Submission: ${input.coverage} - ${input.businessName || "new risk"}${input.applicationCode ? ` (${input.applicationCode})` : ""}`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nPlease reply with your indication or questions.\n${input.staffName ?? "Boreal Risk Management"}`;
  const html = `<p>Please find a new submission from Boreal Risk Management.</p><table>${rows
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0"><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join("")}</table>`
    + `<p>Please reply with your indication or questions.</p><p>${esc(input.staffName ?? "Boreal Risk Management")}</p>`;
  return { subject, html, text };
}
export async function carrierOptionsFor(applicationId: string) {
  const { pool } = await import("../db");
  const { rows } = await pool.query(
    `SELECT ap.id AS application_product_id, ap.stage, ap.carrier AS chosen_carrier,
            p.code, p.display_name, p.country,
            COALESCE(json_agg(json_build_object(
              'id', cp.id, 'carrier', cp.carrier, 'product_name', cp.product_name, 'notes', cp.notes,
              'instant_bind', cp.instant_bind, 'submission_email', cp.submission_email,
              'submission_url', cp.submission_url, 'verified', cp.verified) ORDER BY cp.sort_order, cp.carrier)
              FILTER (WHERE cp.id IS NOT NULL), '[]') AS carriers,
            (SELECT max(s.created_at) FROM bi_carrier_submissions s WHERE s.application_product_id = ap.id) AS last_sent_at
       FROM bi_application_products ap
       JOIN bi_products p ON p.id = ap.product_id
       LEFT JOIN bi_carrier_products cp ON cp.coverage_code = p.code AND cp.country = p.country AND cp.active
      WHERE ap.application_id = $1
      GROUP BY ap.id, p.id
      ORDER BY p.sort_order`,
    [applicationId],
  );
  return rows;
}
export async function sendToCarrier(input: {
  applicationId: string; applicationProductId: string; carrierProductId: string;
  note: string | null; staffName: string | null; staffEmail: string | null; staffId: string | null;
}): Promise<{ ok: true; method: "email" | "portal"; sentTo: string | null } | { ok: false; error: string }> {
  const { pool } = await import("../db");
  const found = await pool.query(
    `SELECT ap.id, p.code, p.display_name, p.country, cp.id AS cp_id, cp.carrier, cp.product_name,
            cp.submission_email, cp.submission_url, a.business_name, a.application_code
       FROM bi_application_products ap
       JOIN bi_products p ON p.id = ap.product_id
       JOIN bi_carrier_products cp ON cp.id = $3 AND cp.coverage_code = p.code AND cp.country = p.country
       JOIN bi_applications a ON a.id = ap.application_id
      WHERE ap.id = $2 AND ap.application_id = $1`,
    [input.applicationId, input.applicationProductId, input.carrierProductId],
  );
  const r = found.rows[0];
  if (!r) return { ok: false, error: "not_found" };
  let method: "email" | "portal" = "portal";
  let sentTo: string | null = r.submission_url ?? null;
  if (r.submission_email) {
    const lim = await pool.query(
      `SELECT max(extracted_limit) AS limit FROM bi_contract_requirements WHERE application_id = $1 AND coverage_code = $2`,
      [input.applicationId, r.code],
    ).catch((err: any) => { console.warn("[carrier-send] limit_read_failed", err?.message); return { rows: [] as any[] }; });
    const mail = buildCarrierEmail({
      businessName: r.business_name, applicationCode: r.application_code, country: r.country, coverage: r.display_name,
      carrierProduct: r.product_name, limit: lim.rows[0]?.limit ? Number(lim.rows[0].limit) : null, note: input.note, staffName: input.staffName,
    });
    const { sendBiMarketingEmail } = await import("./biSendgridService");
    await sendBiMarketingEmail({ to: r.submission_email, ...mail, ...(input.staffEmail ? { replyTo: input.staffEmail } : {}) });
    method = "email";
    sentTo = r.submission_email;
  } else if (!r.submission_url) {
    return { ok: false, error: "no_submission_contact" };
  }
  await pool.query(
    `INSERT INTO bi_carrier_submissions (application_id, application_product_id, carrier_product_id, carrier, method, sent_to, note, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.applicationId, input.applicationProductId, r.cp_id, r.carrier, method, sentTo, input.note, input.staffId],
  );
  await pool.query(
    `UPDATE bi_application_products SET carrier = $2, stage = 'submitted', updated_at = NOW() WHERE id = $1`,
    [input.applicationProductId, r.carrier],
  );
  return { ok: true, method, sentTo };
}
