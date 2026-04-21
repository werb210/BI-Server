export const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "BI Server API",
    version: "1.1.0",
    description: "Boreal Insurance PGI backend API surface"
  },
  servers: [
    {
      url: "https://server.boreal.financial/api/v1",
      description: "Production"
    }
  ],
  tags: [
    { name: "System" },
    { name: "Quote" },
    { name: "Application" },
    { name: "Documents" },
    { name: "Pipeline" },
    { name: "Referral" },
    { name: "Referrer Auth" },
    { name: "Lender" },
    { name: "CRM" },
    { name: "External PGI" },
    { name: "Admin" }
  ],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        responses: {
          200: {
            description: "Server healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    service: { type: "string", example: "bi-server" },
                    timestamp: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/quote": {
      post: {
        tags: ["Quote"],
        summary: "Calculate PGI quote",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/QuoteRequest" }
            }
          }
        },
        responses: {
          200: {
            description: "Quote calculated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/QuoteResponse" }
              }
            }
          }
        }
      }
    },
    "/applications": {
      post: {
        tags: ["Application"],
        summary: "Create PGI application",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateApplicationRequest" }
            }
          }
        },
        responses: {
          200: {
            description: "Application created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    applicationId: { type: "string", format: "uuid" },
                    status: { type: "string", example: "Application Started" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/applications/{id}": {
      get: {
        tags: ["Application"],
        summary: "Get application details",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: {
            description: "Application details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApplicationDetail" }
              }
            }
          }
        }
      }
    },
    "/applications/{id}/documents": {
      post: {
        tags: ["Documents"],
        summary: "Upload application document",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" }
                },
                required: ["file"]
              }
            }
          }
        },
        responses: {
          200: {
            description: "Uploaded",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    documentId: { type: "string", format: "uuid" },
                    status: { type: "string", example: "uploaded" }
                  }
                }
              }
            }
          }
        }
      },
      get: {
        tags: ["Documents"],
        summary: "List application documents",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: {
            description: "Document list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ApplicationDocument" }
                }
              }
            }
          }
        }
      }
    },
    "/pipeline/lender/{lenderId}": {
      get: {
        tags: ["Pipeline", "Lender"],
        summary: "Get lender pipeline",
        parameters: [{ name: "lenderId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: {
            description: "Lender pipeline",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/PipelineItem" }
                }
              }
            }
          }
        }
      }
    },
    "/referrals": {
      post: {
        tags: ["Referral"],
        summary: "Create referral + CRM contact",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReferralRequest" }
            }
          }
        },
        responses: {
          200: {
            description: "Referral created",
            content: {
              "application/json": {
                schema: { type: "object", properties: { status: { type: "string", example: "created" } } }
              }
            }
          }
        }
      }
    },
    "/referrer/login": { post: { tags: ["Referrer Auth"], summary: "Referrer login challenge", responses: { 200: { description: "Challenge created" } } } },
    "/referrer/verify": { post: { tags: ["Referrer Auth"], summary: "Verify referrer challenge", responses: { 200: { description: "Verified" } } } },
    "/lender/login": { post: { tags: ["Lender"], summary: "Lender login", responses: { 200: { description: "Authenticated" } } } },
    "/lender/dashboard/{lenderId}": {
      get: {
        tags: ["Lender", "Pipeline"],
        summary: "Get lender dashboard",
        parameters: [{ name: "lenderId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: {
            description: "Dashboard payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    applications: { type: "array", items: { $ref: "#/components/schemas/ApplicationDetail" } },
                    pipeline: { type: "array", items: { $ref: "#/components/schemas/PipelineItem" } }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/crm/contact": {
      post: {
        tags: ["CRM"],
        summary: "Create CRM contact",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CrmContactRequest" } } } },
        responses: { 200: { description: "Created" } }
      }
    },
    "/crm/application": {
      post: {
        tags: ["CRM"],
        summary: "Create CRM application event",
        responses: { 200: { description: "Created" } }
      }
    },
    "/external/pgi/submit": {
      post: {
        tags: ["External PGI"],
        summary: "Submit full application payload to external PGI",
        responses: { 200: { description: "Submitted" } }
      }
    },
    "/admin/applications": { get: { tags: ["Admin"], summary: "List all applications", responses: { 200: { description: "List" } } } },
    "/admin/pipeline": { get: { tags: ["Admin", "Pipeline"], summary: "List pipeline", responses: { 200: { description: "Pipeline" } } } }
  },
  components: {
    schemas: {
      QuoteRequest: {
        type: "object",
        required: ["loanAmount", "coveragePercent", "loanType"],
        properties: {
          loanAmount: { type: "number", minimum: 1 },
          coveragePercent: { type: "number", maximum: 80, description: "May be passed as 0-80 or 0.0-0.8" },
          loanType: { type: "string", enum: ["secured", "unsecured"] }
        }
      },
      QuoteResponse: {
        type: "object",
        properties: {
          insuredAmount: { type: "number" },
          premium: { type: "number" },
          rate: { type: "number" },
          maxCoverage: { type: "number", example: 0.8 }
        }
      },
      Applicant: {
        type: "object",
        required: ["firstName", "lastName", "email", "phone"],
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" }
        }
      },
      CreateApplicationRequest: {
        type: "object",
        required: ["companyName", "loanAmount", "loanType", "coveragePercent", "applicant"],
        properties: {
          companyName: { type: "string" },
          loanAmount: { type: "number" },
          loanType: { type: "string", enum: ["secured", "unsecured"] },
          coveragePercent: { type: "number" },
          applicant: { $ref: "#/components/schemas/Applicant" },
          referrerId: { type: "string", nullable: true },
          lenderId: { type: "string", nullable: true }
        }
      },
      ApplicationDocument: {
        type: "object",
        properties: {
          documentId: { type: "string", format: "uuid" },
          filename: { type: "string" },
          mimeType: { type: "string" },
          size: { type: "number" },
          uploadedAt: { type: "string", format: "date-time" }
        }
      },
      ApplicationDetail: {
        type: "object",
        properties: {
          applicationId: { type: "string", format: "uuid" },
          status: { type: "string" },
          stage: { type: "string" },
          quote: { $ref: "#/components/schemas/QuoteResponse" },
          documents: { type: "array", items: { $ref: "#/components/schemas/ApplicationDocument" } },
          timeline: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stage: { type: "string" },
                timestamp: { type: "string", format: "date-time" }
              }
            }
          }
        }
      },
      PipelineItem: {
        type: "object",
        properties: {
          applicationId: { type: "string" },
          companyName: { type: "string" },
          stage: { type: "string", enum: [
            "Quote Created",
            "Application Started",
            "Application Submitted",
            "Under Review (Purbeck underwriting)",
            "Approved",
            "Policy Issued",
            "Declined"
          ] },
          loanAmount: { type: "number" }
        }
      },
      ReferralRequest: {
        type: "object",
        required: ["company", "firstName", "lastName", "email", "phone"],
        properties: {
          company: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" }
        }
      },
      CrmContactRequest: {
        type: "object",
        required: ["name", "email"],
        properties: {
          name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          tags: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};
