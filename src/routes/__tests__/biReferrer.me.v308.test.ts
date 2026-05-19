// BI_SERVER_BLOCK_v308_REFERRER_ME_PROFILE_WRAPPER_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("../middleware/requireReferrer", () => ({
  requireReferrer: (req: any, _res: any, next: any) => {
    req.referrerId = "11111111-1111-4111-8111-111111111111";
    next();
  },
}));

// Adjust the requireReferrer mock import path to match the repo's actual
// module path. If requireReferrer is defined inline in biReferrerRoutes.ts
// (not its own module), use a different mocking approach — see existing
// tests in this directory for the pattern.

describe("GET /referrer/me", () => {
  it.todo("returns { profile: {...}, intake_complete, referrer } shape");
  it.todo("populates profile.legal_name from full_name when set");
  it.todo("populates profile.legal_name from first_name+last_name when full_name missing");
  it.todo("returns 404 when referrer row missing");
});
