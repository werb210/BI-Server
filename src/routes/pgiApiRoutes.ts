import { Router } from "express";
import { randomUUID } from "crypto";

import { getPGIStatus, submitToPGI, type BIApplication } from "../services/pgiAdapter";
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

  const result = await getPGIStatus(id);
  return ok(res, { mode: "pgi", ...result });
});

export default router;
