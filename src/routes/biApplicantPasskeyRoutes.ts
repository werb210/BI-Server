// BI_SERVER_BLOCK_v601
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { env } from "../platform/env";
import { rateLimitKeyFromRequest } from "../middleware/rateLimitKey";
import { authApplicant, type ApplicantReq } from "./applicantAuth";
import { beginApplicantPasskeyRegistration, finishApplicantPasskeyRegistration, beginApplicantPasskeySignIn, finishApplicantPasskeySignIn, listApplicantPasskeys, removeApplicantPasskey } from "../services/biApplicantPasskeys";
const router = Router();
const q = (sql: string, params: unknown[]) => pool.query(sql, params as any[]);
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: rateLimitKeyFromRequest, validate: { xForwardedForHeader: false, trustProxy: false }, message: { error: "rate_limited" } });
const rpId = "client.boreal.insure";
const origin = "https://client.boreal.insure";
const fail = (res: any, error: unknown, status = 400) => { console.warn("[applicant-passkey] rejected", error instanceof Error ? error.message : error); return res.status(status).json({ error: "passkey_invalid" }); };
router.post("/applicants/passkeys/register/options", authApplicant, async (req: ApplicantReq, res) => { try { res.json(await beginApplicantPasskeyRegistration(q, String(req.applicantPhone), rpId)); } catch (e) { fail(res, e, 500); } });
router.post("/applicants/passkeys/register", authApplicant, async (req: ApplicantReq, res) => { try { res.status(201).json(await finishApplicantPasskeyRegistration(q, String(req.applicantPhone), req.body, rpId, origin)); } catch (e) { fail(res, e); } });
router.post("/applicants/passkeys/sign-in/options", limiter, async (req, res) => { try { res.json(await beginApplicantPasskeySignIn(q, typeof req.body?.credentialId === "string" ? req.body.credentialId : undefined)); } catch (e) { fail(res, e, 500); } });
router.post("/applicants/passkeys/sign-in", limiter, async (req, res) => { try { res.json(await finishApplicantPasskeySignIn(q, req.body, env.JWT_SECRET || "dev-missing-jwt-secret", rpId, origin)); } catch (e) { fail(res, e, 401); } });
router.get("/applicants/passkeys", authApplicant, async (req: ApplicantReq, res) => { try { res.json({ passkeys: await listApplicantPasskeys(q, String(req.applicantPhone)) }); } catch (e) { fail(res, e, 500); } });
router.delete("/applicants/passkeys/:credentialId", authApplicant, async (req: ApplicantReq, res) => { try { const removed = await removeApplicantPasskey(q, String(req.applicantPhone), String(req.params.credentialId)); res.status(removed ? 200 : 404).json({ removed }); } catch (e) { fail(res, e, 500); } });
// BI_SERVER_BLOCK_v611_PASSKEY_REPAIR - the paths BI-Client v602 calls.
router.post("/applicants/passkeys/registration-options", authApplicant, async (req: ApplicantReq, res) => { try { res.json(await beginApplicantPasskeyRegistration(q, String(req.applicantPhone), rpId)); } catch (e) { fail(res, e, 500); } });
router.post("/applicants/passkeys/authentication-options", limiter, async (req, res) => { try { res.json(await beginApplicantPasskeySignIn(q, typeof req.body?.credentialId === "string" ? req.body.credentialId : undefined)); } catch (e) { fail(res, e, 500); } });
router.post("/applicants/passkeys/authenticate", limiter, async (req, res) => { try { res.json(await finishApplicantPasskeySignIn(q, req.body, env.JWT_SECRET || "dev-missing-jwt-secret", rpId, origin)); } catch (e) { fail(res, e, 401); } });
export default router;
