// BI_APOLLO_RUN_v55_PHASE3 — campaign-readiness routes.
import { Router } from "express";
import { pool } from "../db";
import { ok, badRequest } from "../utils/apiResponse";
import { enrichContact } from "../integrations/apollo/apolloEnrichOnDemand";
import { searchPeople } from "../integrations/apollo/apolloClient";
import { enrollContactsInSequence, ICP_SEGMENTS, type IcpSegment } from "../integrations/apollo/apolloSequenceService";
import { logger } from "../platform/logger";
const router = Router(); const UUID=/^[0-9a-f-]{36}$/i;
router.post('/contacts/:id/enrich', async (req,res)=>{ const id=req.params.id; if(!UUID.test(id)) return badRequest(res,'invalid contact id'); try { return ok(res, await enrichContact(id, {force:req.query.force==='1'})); } catch(err){ logger.error({err,id},'enrich failed'); return badRequest(res,'enrichment failed'); } });
router.post('/apollo/search-people', async (req,res)=>{ try { return ok(res, await searchPeople(req.body??{})); } catch(err){ logger.error({err},'people search failed'); return badRequest(res,'search failed'); } });
router.post('/apollo/sequences/:apolloSequenceId/enroll', async (req,res)=>{ const sid=req.params.apolloSequenceId; const {contact_ids, icp_segment, email_account_id}=(req.body??{}) as {contact_ids:string[], icp_segment?:IcpSegment, email_account_id?:string}; if(!Array.isArray(contact_ids)||!contact_ids.length) return badRequest(res,'contact_ids required'); if(icp_segment && !ICP_SEGMENTS.includes(icp_segment)) return badRequest(res,'invalid icp_segment'); try { return ok(res, await enrollContactsInSequence({sequenceId:sid, contactIds:contact_ids, icpSegment:icp_segment, emailAccountId:email_account_id})); } catch(err){ logger.error({err,sid}, 'enroll failed'); return badRequest(res,'enroll failed'); } });
export default router;
