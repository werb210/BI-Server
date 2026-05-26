// BI_SERVER_BLOCK_v355_LENDER_OPENAPI_V2_v1
// OpenAPI 3.1 spec for the Boreal Risk Lender Direct API — v2 carrier-aligned.
// Source of truth: Craig's PGI/Purbeck changelog 2026-05-25 (14 form_data
// fields, 11 declarations, 5+2 documents, $50K-$1M, 80% PGI cap, CA-only ex-QC).
import { Router } from "express";

const router = Router();

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Boreal Risk Lender API",
    version: "2.0.0",
    description:
      "Submit Personal Guarantee Insurance (PGI) applications programmatically.\n\n" +
      "**JSON over HTTPS. Bearer-key auth.** CORE Score returned synchronously on submit.\n\n" +
      "### Eligibility (carrier rules)\n" +
      "- **Canada only** — `business.country = \"CA\"`. US not yet supported.\n" +
      "- **Quebec excluded** — `business.province` must NOT be `QC`.\n" +
      "- **Loan amount** — between **$50,000 CAD** and **$1,000,000 CAD**.\n" +
      "- **PGI limit** — at most **80% of loan amount**, never above **$1,000,000 CAD**.\n" +
      "- **Loan type** — one of `Commercial Mortgage` or `Other Secured Loan`. Others are rejected.\n" +
      "- **Government ID type** — one of `Passport`, `National ID`, `Driving Licence`, `Other`.\n\n" +
      "### What's required\n" +
      "14 carrier form_data fields (split across `guarantor` / `business` / `loan`), the 11 `declarations`, " +
      "and 5 required documents (plus 2 more if the business is under 3 years old). " +
      "Internal CORE Score fields (`financials.*`) are accepted but not carrier-required; include them " +
      "to speed up our underwriting.\n\n" +
      "### v1 → v2 migration\n" +
      "Flat-shape payloads (v1) are still accepted with a `Deprecation: true` HTTP header. New " +
      "integrations should use the nested v2 shape documented here. v1 will be sunset 2026-12-31.",
    contact: { name: "Boreal Risk Management", url: "https://boreal.insure/lender/api" },
  },
  servers: [
    { url: "https://bi-server-cse0apamgkheb9d5.canadacentral-01.azurewebsites.net", description: "Production" },
  ],
  components: {
    securitySchemes: {
      LenderBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "bk_<prefix>.<secret>",
        description: "Lender API key. Generate in the Lender Portal sandbox; full secret is shown once at creation.",
      },
    },
    schemas: {
      Guarantor: {
        type: "object",
        required: ["name", "phone", "email", "dob", "address", "q_ca_id_type", "q_ca_id_number"],
        properties: {
          name:            { type: "string", description: "Full legal name (carrier q2_full_name).", example: "Sarah Chen" },
          phone:           { type: "string", description: "E.164. Used for guarantor SMS + records.", example: "+14165551234" },
          email:           { type: "string", format: "email", description: "Carrier q7_email.", example: "sarah.chen@example.com" },
          dob:             { type: "string", format: "date", description: "Date of birth, YYYY-MM-DD (carrier q4_date_of_birth).", example: "1985-06-15" },
          address:         { type: "string", description: "Residential address, free text (carrier q5_residential_address).", example: "456 Oak Avenue, Toronto, ON M4V 2P7" },
          q_ca_id_type:    { type: "string", enum: ["Passport", "National ID", "Driving Licence", "Other"], description: "Government ID type." },
          q_ca_id_number:  { type: "string", description: "The identifier on the government ID (passport number, driver's licence number, etc.).", example: "DL123456789" },
        },
      },
      Business: {
        type: "object",
        required: ["naics", "start_date", "address", "province"],
        properties: {
          country:     { type: "string", enum: ["CA"], default: "CA", description: "Carrier accepts CA only at this time." },
          naics:       { type: "string", description: "6-digit NAICS code (carrier q25_naics_code).", example: "541511" },
          start_date:  { type: "string", format: "date", description: "Date the business began generating revenue (carrier q26_formation_date).", example: "2019-03-15" },
          address:     { type: "string", description: "Operating address, free text (carrier q17_business_operating_address).", example: "789 King Street West, Toronto, ON M5H 2A9" },
          province:    { type: "string", description: "2-letter Canadian province. Quebec (QC) is not eligible.", example: "ON" },
          website:     { type: "string", description: "Business website URL.", example: "https://example.com" },
          entity_type: { type: "string", enum: ["Corporation", "Partnership", "Sole Proprietorship", "LLC", "Other"] },
          business_number: { type: "string", description: "Canada Revenue Agency Business Number (BN). Optional.", example: "123456789RT0001" },
        },
      },
      Loan: {
        type: "object",
        required: ["amount", "pgi_limit", "q_ca_loan_type"],
        properties: {
          amount:           { type: "number", minimum: 50000, maximum: 1000000, description: "CAD. Carrier q41_loan_amount.", example: 500000 },
          pgi_limit:        { type: "number", minimum: 1, maximum: 1000000, description: "CAD. Must be ≤ 80% of `amount`. Carrier q42_pgi_limit.", example: 400000 },
          q_ca_loan_type:   { type: "string", enum: ["Commercial Mortgage", "Other Secured Loan"], description: "Only these two loan types are carrier-eligible." },
          use_of_proceeds:  { type: "string", enum: ["working_capital", "acquisition", "expansion", "equipment", "real_estate", "refinance"] },
          loan_funding_date: { type: "string", format: "date", example: "2026-06-15" },
          policy_start_date: { type: "string", format: "date", example: "2026-06-15" },
          csbfp_backed:     { type: "boolean" },
          loan_has_guaranteed_cap: { type: "boolean" },
          personally_guaranteeing: { type: "boolean" },
        },
      },
      Financials: {
        type: "object",
        description: "Optional. Used for our internal CORE Score (not carrier-required).",
        properties: {
          revenue_last_year:    { type: "number", description: "Annual revenue, CAD.", example: 4000000 },
          ebitda_last_year:     { type: "number", example: 670000 },
          total_debt:           { type: "number", example: 800000 },
          monthly_debt_service: { type: "number", example: 5600 },
          collateral_value:     { type: "number", example: 400000 },
          enterprise_value:     { type: "number", example: 6000000 },
        },
      },
      Declarations: {
        type: "object",
        description:
          "All 11 fields are required. Use `\"yes\" | \"no\"` for the 10 yes/no items and `\"Agree\" | \"Disagree\"` for `section_3_c`. " +
          "Any adverse answer (`\"yes\"` on a risk question or `\"Disagree\"` on the oath) requires a matching `*_reason` string explaining.",
        required: ["section_1_a", "section_1_2", "section_2_a", "section_2_b", "section_2_c", "section_2_d", "section_3_a", "section_3_c", "section_4_a", "section_5_a", "section_6_a"],
        properties: {
          section_1_a: { type: "string", enum: ["yes", "no"], description: "Does the business carry insurance coverage for all physical assets covered by the personal guarantee?" },
          section_1_2: { type: "string", enum: ["yes", "no"], description: "Have you ever declared personal bankruptcy? (\"yes\" requires section_1_2_reason)" },
          section_1_2_reason: { type: "string", description: "Required if section_1_2 is \"yes\"." },
          section_2_a: { type: "string", enum: ["yes", "no"], description: "Have you ever been barred from serving as a Director, or are you currently under investigation that could result in being barred?" },
          section_2_a_reason: { type: "string" },
          section_2_b: { type: "string", enum: ["yes", "no"], description: "Have you ever been a Director of a company that has gone through bankruptcy, receivership, or restructuring proceedings?" },
          section_2_b_reason: { type: "string" },
          section_2_c: { type: "string", enum: ["yes", "no"], description: "Have you ever been a Director of a company under investigation by the Canada Revenue Agency or the Canada Border Services Agency?" },
          section_2_c_reason: { type: "string" },
          section_2_d: { type: "string", enum: ["yes", "no"], description: "Do you currently have any actual or contingent liability that you will not be able to pay within 30 days of when it becomes due?" },
          section_2_d_reason: { type: "string" },
          section_3_a: { type: "string", enum: ["yes", "no"], description: "Does the business currently have any bad or doubtful debts owed to it that are likely to materially affect its ability to pay liabilities as they become due?" },
          section_3_a_reason: { type: "string" },
          section_3_c: { type: "string", enum: ["Agree", "Disagree"], description: "I confirm that all answers above are true to the best of my knowledge. (Disagree requires section_3_c_reason)" },
          section_3_c_reason: { type: "string" },
          section_4_a: { type: "string", enum: ["yes", "no"], description: "Has the business lost a significant investor, customer, or supplier in the last 6 months?" },
          section_4_a_reason: { type: "string" },
          section_5_a: { type: "string", enum: ["yes", "no"], description: "Are you aware of any information that could materially affect the business's ability to meet its obligations over the next 6 months?" },
          section_5_a_reason: { type: "string" },
          section_6_a: { type: "string", enum: ["yes", "no"], description: "As of today, is the company solvent (able to pay its debts as they become due)?" },
        },
      },
      CoGuarantor: {
        type: "object",
        required: ["first_name", "last_name", "email", "phone"],
        properties: {
          first_name:    { type: "string" },
          last_name:     { type: "string" },
          email:         { type: "string", format: "email" },
          date_of_birth: { type: "string", format: "date" },
          phone:         { type: "string", description: "E.164" },
          address:       { type: "string" },
          city:          { type: "string" },
          province:      { type: "string", description: "2-letter Canadian province" },
          postal_code:   { type: "string" },
          relationship:  { type: "string", enum: ["Guarantor", "Co-borrower", "Spouse", "Business Partner", "Other"] },
        },
      },
      ApplicationSubmit: {
        type: "object",
        required: ["company_name", "guarantor", "business", "loan", "declarations"],
        properties: {
          company_name: { type: "string", description: "Carrier q15_business_legal_name. Mirror in business.name.", example: "Maple Leaf Technologies Inc." },
          lender_name:  { type: "string", description: "The originating lender for our records.", example: "Acme Bank" },
          guarantor:    { $ref: "#/components/schemas/Guarantor" },
          business:     { $ref: "#/components/schemas/Business" },
          loan:         { $ref: "#/components/schemas/Loan" },
          financials:   { $ref: "#/components/schemas/Financials" },
          declarations: { $ref: "#/components/schemas/Declarations" },
          co_guarantors: { type: "array", items: { $ref: "#/components/schemas/CoGuarantor" } },
        },
        example: {
          company_name: "Maple Leaf Technologies Inc.",
          lender_name: "Acme Bank",
          guarantor: {
            name: "Sarah Chen", phone: "+14165551234", email: "sarah.chen@example.com",
            dob: "1985-06-15", address: "456 Oak Avenue, Toronto, ON M4V 2P7",
            q_ca_id_type: "Driving Licence", q_ca_id_number: "DL123456789",
          },
          business: {
            country: "CA", naics: "541511", start_date: "2019-03-15",
            address: "789 King Street West, Toronto, ON M5H 2A9", province: "ON",
            website: "https://example.com", entity_type: "Corporation",
          },
          loan: {
            amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Commercial Mortgage",
            use_of_proceeds: "expansion", loan_funding_date: "2026-06-15",
            policy_start_date: "2026-06-15", csbfp_backed: false,
            loan_has_guaranteed_cap: false, personally_guaranteeing: true,
          },
          financials: {
            revenue_last_year: 4000000, ebitda_last_year: 670000,
            total_debt: 800000, monthly_debt_service: 5600,
            collateral_value: 400000, enterprise_value: 6000000,
          },
          declarations: {
            section_1_a: "yes", section_1_2: "no",
            section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no",
            section_3_a: "no", section_3_c: "Agree",
            section_4_a: "no", section_5_a: "no", section_6_a: "yes",
          },
          co_guarantors: [],
        },
      },
      ApplicationResponse: {
        type: "object",
        properties: {
          application_id:     { type: "string", format: "uuid" },
          application_code:   { type: "string", example: "PGI-A1B2C3D4" },
          public_id:          { type: "string" },
          status:             { type: "string", enum: ["created", "in_progress", "ready_for_submission", "submitted", "under_review", "information_required", "approved", "declined", "policy_issued", "cancelled"] },
          score_id:           { type: "string" },
          score:              { type: "number", description: "Synchronous CORE Score." },
          pgi_application_id: { type: "string", nullable: true, description: "Set once the application has been forwarded to the carrier." },
          pgi_status:         { type: "string", nullable: true },
          pgi_error:          { type: "string", nullable: true },
        },
      },
      ValidationError: {
        type: "object",
        properties: {
          error: { type: "string", example: "validation_failed" },
          issues: { type: "array", items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } } },
          hint: { type: "string" },
        },
      },
      Document: {
        type: "object",
        properties: {
          id: { type: "string" },
          doc_type: { type: "string", enum: ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"] },
          filename: { type: "string" },
          uploaded_at: { type: "string", format: "date-time" },
        },
      },
      TimelineEvent: {
        type: "object",
        properties: {
          event_type: { type: "string" },
          summary: { type: "string" },
          occurred_at: { type: "string", format: "date-time" },
        },
      },
    },
  },
  security: [{ LenderBearer: [] }],
  paths: {
    "/api/v1/lender/applications": {
      post: {
        summary: "Submit a new PGI application (carrier-aligned v2)",
        operationId: "submitApplication",
        description:
          "Validates against the carrier schema (14 form_data fields + 11 declarations) and forwards to Purbeck. " +
          "On success, the response includes the carrier's application_id once acked. Legacy flat-shape v1 payloads " +
          "are still accepted but return a `Deprecation: true` header; migrate to the v2 nested shape documented here.",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationSubmit" } } } },
        responses: {
          "201": { description: "Created. Application persisted + forwarded to carrier.", content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationResponse" } } } },
          "400": { description: "Validation failed (one or more carrier-required fields missing/invalid).", content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationError" } } } },
          "401": { description: "Missing or invalid API key." },
          "422": { description: "CORE Score declined — refer to `score_id` for our internal reason." },
          "429": { description: "Rate limited (per API key)." },
        },
      },
      get: {
        summary: "List your submitted applications",
        operationId: "listApplications",
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/ApplicationResponse" } } } } } } },
        },
      },
    },
    "/api/v1/lender/applications/{code}/documents": {
      post: {
        summary: "Upload supporting documents (multipart)",
        operationId: "uploadDocuments",
        description:
          "Upload the 5 carrier-required documents (`loan_agreement`, `profit_loss`, `balance_sheet`, `ar_aging`, `ap_aging`) " +
          "via multipart form-data. If the business is under 3 years old, also upload `founder_cv` + `financial_forecast`. " +
          "**Constraints:** 5 MB max per file. Accepted formats: PDF, DOCX, XLS, XLSX, CSV, MD. Image files (PNG/JPG/HEIC) are NOT accepted.",
        parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  files: { type: "array", items: { type: "string", format: "binary" }, description: "One file per slot. Parallel to `doc_types` array." },
                  doc_types: { type: "array", items: { type: "string", enum: ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"] }, description: "One doc_type per file, same order as `files`." },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { documents: { type: "array", items: { $ref: "#/components/schemas/Document" } } } } } } },
          "400": { description: "Invalid doc_type, MIME, or file too large." },
        },
      },
      get: {
        summary: "List uploaded documents",
        operationId: "listDocuments",
        parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { documents: { type: "array", items: { $ref: "#/components/schemas/Document" } } } } } } },
        },
      },
    },
    "/api/v1/lender/applications/{code}/timeline": {
      get: {
        summary: "Poll the timeline for carrier-side events",
        operationId: "getTimeline",
        parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { events: { type: "array", items: { $ref: "#/components/schemas/TimelineEvent" } } } } } } },
        },
      },
    },
    "/api/v1/lender/me": {
      get: {
        summary: "Get the authenticated lender's profile",
        operationId: "getLenderMe",
        responses: { "200": { description: "OK" } },
      },
    },
  },
} as const;

router.get("/lender/openapi.json", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(SPEC);
});

export default router;
