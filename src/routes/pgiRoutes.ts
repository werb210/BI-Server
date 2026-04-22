import { Router } from "express";
import { submitApplicationToPGI } from "../services/biPgiSubmissionService";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

router.post("/application/:id/submit-pgi", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await submitApplicationToPGI(id);
    return ok(res, { success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit to PGI";
    return badRequest(res, message);
  }
});

export default router;
