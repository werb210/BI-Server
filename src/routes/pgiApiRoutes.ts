import { Router } from "express";
import { randomUUID } from "crypto";

import { pool } from "../db";
import { getPGIQuote, submitToPGI, type BIApplication } from "../services/pgiAdapter";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const useStub = (process.env.USE_PGI_STUB || "false").toLowerCase() === "true";

const stubStore = new Map<string, { id: string; status: string; payload: BIApplication }>();

router.post("/bi/pgi/applications", async (req, res) => {
  const payload = req.body as BIApplication;

  if (!payload?.businessName || !payload?.loanAmount || !payload?.email) {
    return badRequest(res, "Invalid application payload");
  }

  if (useStub) {
    const id = randomUUID();
    stubStore.set(id, { id, status: "under_review", payload });
    return ok(res, { mode: "stub", externalId: id, status: "under_review" });
  }

  const result = await submitToPGI(payload);
  return ok(res, { mode: "pgi", ...result });
});

router.get("/bi/pgi/applications/:id", async (req, res) => {
  const { id } = req.params;

  if (useStub) {
    const app = stubStore.get(id);
    if (!app) {
      return badRequest(res, "Application not found");
    }
    return ok(res, { mode: "stub", ...app });
  }

  const quoteResult = await pool.query<{ quote_id: string | null; underwriter_ref: string | null }>(
    `SELECT quote_id, underwriter_ref
     FROM bi_applications
     WHERE id::text = $1 OR pgi_external_id = $1
     LIMIT 1`,
    [id]
  );
  const quoteId = quoteResult.rows[0]?.quote_id ?? quoteResult.rows[0]?.underwriter_ref ?? id;
  const result = await getPGIQuote(quoteId);
  return ok(res, { mode: "pgi", ...result });
});

export default router;
