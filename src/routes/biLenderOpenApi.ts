// BI_SERVER_BLOCK_69_LENDER_OPENAPI_SPEC_v1
import { Router } from "express";

const router = Router();

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Boreal Risk Lender API",
    version: "1.0.0",
    description:
      "Submit Personal Guarantee Insurance (PGI) applications programmatically. JSON over HTTPS. Bearer-key auth. CORE Score returned synchronously on submit.",
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
      ApplicationSubmit: {
        type: "object",
        required: [
          "country", "naics_code", "formation_date", "loan_amount", "pgi_limit",
          "annual_revenue", "ebitda", "total_debt", "monthly_debt_service",
          "collateral_value", "enterprise_value", "guarantor_name", "guarantor_email",
          "business_name", "lender_name",
        ],
        properties: {
          country: { type: "string", enum: ["CA", "US"] },
          naics_code: { type: "string", example: "541511" },
          formation_date: { type: "string", format: "date" },
          loan_amount: { type: "number" },
          pgi_limit: { type: "number" },
          annual_revenue: { type: "number" },
          ebitda: { type: "number" },
          total_debt: { type: "number" },
          monthly_debt_service: { type: "number" },
          collateral_value: { type: "number" },
          enterprise_value: { type: "number" },
          guarantor_name: { type: "string" },
          guarantor_email: { type: "string", format: "email" },
          business_name: { type: "string" },
          lender_name: { type: "string" },
          bankruptcy_history: { type: "boolean", default: false },
          insolvency_history: { type: "boolean", default: false },
          judgment_history: { type: "boolean", default: false },
        },
      },
      ApplicationResponse: {
        type: "object",
        properties: {
          application_code: { type: "string", example: "PGI-A1B2C3D4" },
          core_score: { type: "number" },
          status: { type: "string", enum: ["new_application", "submitted", "sent_to_pgi", "under_review", "approved", "declined"] },
          decline_reasons: { type: "array", items: { type: "string" } },
        },
      },
      Document: {
        type: "object",
        properties: {
          id: { type: "string" },
          doc_type: { type: "string" },
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
        summary: "Submit a new PGI application",
        operationId: "submitApplication",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationSubmit" } } } },
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationResponse" } } } },
          "400": { description: "Validation error" },
          "401": { description: "Unauthorized" },
          "429": { description: "Rate limited" },
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
        parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  files: { type: "array", items: { type: "string", format: "binary" } },
                  doc_types: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { documents: { type: "array", items: { $ref: "#/components/schemas/Document" } } } } } } },
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
