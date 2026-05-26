// BI_SERVER_BLOCK_v370_DEDUPE_LENDER_SUBMIT_v1
// Single source of truth for "send a lender application to the carrier".
// Both POST /api/v1/lender/applications handlers (biLenderApiRoutes.ts
// for legacy API key auth, biLenderApplicationCreate.ts for portal JWT
// auth) call into this function so a future change to the carrier
// envelope shape touches one file instead of two.
import { pool } from "../db";
import { buildCarrierPayloadV2 } from "./pgiCarrierMapper";
import { pgiSubmit } from "./pgiAdapter";
import { logger } from "../platform/logger";

export interface LenderCarrierSubmitInput {
  applicationId: string;
  publicId: string;
  isDemo: boolean;
  // Top-level carrier envelope fields (v358).
  guarantor_name: string;
  guarantor_email: string;
  business_name: string;
  lender_name: string | null;
  // Row snapshot for the mapper.
  rowSnapshot: Record<string, unknown>;
  formData: Record<string, unknown>;
  declarations: Record<string, unknown>;
}

export interface LenderCarrierSubmitResult {
  pgi_application_id: string | null;
  pgi_status: string | null;
  pgi_error: string | null;
  carrier_request_body: unknown;
  carrier_response: unknown;
}

export async function submitLenderApplicationToCarrier(input: LenderCarrierSubmitInput): Promise<LenderCarrierSubmitResult> {
  const carrierRequestBody = buildCarrierPayloadV2(
    input.rowSnapshot as any,
    input.formData as any,
    input.declarations as any,
    {
      guarantor_name: input.guarantor_name,
      guarantor_email: input.guarantor_email,
      business_name: input.business_name,
      lender_name: input.lender_name,
    }
  );

  if (input.isDemo) {
    const stubId = `DEMO_${input.publicId}`;
    await pool.query(
      `UPDATE bi_applications
          SET pgi_application_id = $1,
              status = 'submitted',
              carrier_received_at = NOW(),
              carrier_last_event = 'demo_submit',
              carrier_submission_request = $2::jsonb,
              carrier_submission_response = $3::jsonb,
              updated_at = NOW()
        WHERE id = $4`,
      [stubId, JSON.stringify(carrierRequestBody), JSON.stringify({ demo: true }), input.applicationId]
    );
    return {
      pgi_application_id: stubId,
      pgi_status: "demo",
      pgi_error: null,
      carrier_request_body: carrierRequestBody,
      carrier_response: { demo: true },
    };
  }

  let carrierResponse: any = null;
  let pgiError: string | null = null;
  try {
    carrierResponse = await pgiSubmit(carrierRequestBody as any);
  } catch (err) {
    pgiError = (err as Error)?.message ?? "carrier submit failed";
    logger.error({ err, applicationId: input.applicationId }, "lender_carrier_submit_failed");
  }

  const pgiAppId: string | null = carrierResponse?.application_id ?? null;
  const pgiStatus: string | null = carrierResponse?.status ?? null;

  await pool.query(
    `UPDATE bi_applications
        SET pgi_application_id = $1,
            status = COALESCE($2, status),
            carrier_received_at = NOW(),
            carrier_last_event = $3,
            carrier_submission_request = $4::jsonb,
            carrier_submission_response = $5::jsonb,
            updated_at = NOW()
      WHERE id = $6`,
    [
      pgiAppId,
      pgiAppId ? "submitted" : null,
      pgiAppId ? "submitted" : "submit_failed",
      JSON.stringify(carrierRequestBody),
      JSON.stringify(carrierResponse ?? { error: pgiError }),
      input.applicationId,
    ]
  );

  return {
    pgi_application_id: pgiAppId,
    pgi_status: pgiStatus,
    pgi_error: pgiError,
    carrier_request_body: carrierRequestBody,
    carrier_response: carrierResponse,
  };
}
