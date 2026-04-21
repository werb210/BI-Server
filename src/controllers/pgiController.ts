import { Request, Response } from "express";
import { pool } from "../db";
import { BIApplication, submitToPGI } from "../services/pgiAdapter";

let submitter: (app: BIApplication) => Promise<{ externalId: string; status: string }> = submitToPGI;

export function setPGISubmitterForTests(fn: typeof submitter) {
  submitter = fn;
}

export function resetPGISubmitterForTests() {
  submitter = submitToPGI;
}

export async function submitApplication(req: Request, res: Response) {
  try {
    const result = await submitter(req.body as BIApplication);

    const applicationId = (req.body as { id?: string }).id ?? result.externalId;
    const now = new Date().toISOString();

    const stored = {
      ...req.body,
      applicationId,
      externalId: result.externalId,
      status: result.status,
      stage: "Application Submitted",
      timeline: [
        {
          stage: "Application Submitted",
          timestamp: now
        }
      ],
      updatedAt: now,
      createdAt: now
    };

    await pool.query(
      `INSERT INTO pgi_applications(id, data)
       VALUES($1, $2::jsonb)
       ON CONFLICT (id)
       DO UPDATE SET data = EXCLUDED.data`,
      [applicationId, JSON.stringify(stored)]
    );

    return res.json({
      success: true,
      externalId: result.externalId,
      status: result.status
    });
  } catch (err: unknown) {
    const error = err as { response?: { data?: unknown }; message?: string };
    console.error("PGI submit error:", error?.response?.data || error?.message);

    return res.status(500).json({
      success: false,
      error: "Failed to submit to PGI"
    });
  }
}
