import { Router } from "express";
import { pool } from "../db";
import { handleGraphReplyWebhook } from "../integrations/microsoftGraphSubscriptions";

const router = Router();
const userIdOf = (req: any) => req.user?.id ?? req.user?.staffUserId;

router.get('/sequences', async (_req,res)=>res.json({ sequences:(await pool.query(`SELECT * FROM bi_sequences ORDER BY created_at DESC`)).rows }));
router.post('/sequences', async (req,res)=>res.status(201).json({ sequence:(await pool.query(`INSERT INTO bi_sequences (name, owner_user_id) VALUES ($1,$2) RETURNING *`, [req.body?.name, userIdOf(req)])).rows[0] }));
router.get('/sequences/:id', async (req,res)=>{ const r=await pool.query(`SELECT * FROM bi_sequences WHERE id=$1`,[req.params.id]); if(!r.rows[0]) return res.status(404).json({error:'not_found'}); res.json({sequence:r.rows[0]});});
router.patch('/sequences/:id', async (req,res)=>res.json({ sequence:(await pool.query(`UPDATE bi_sequences SET name=COALESCE($2,name), is_active=COALESCE($3,is_active), updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id, req.body?.name ?? null, req.body?.is_active ?? null])).rows[0] }));
router.delete('/sequences/:id', async (req,res)=>{await pool.query(`DELETE FROM bi_sequences WHERE id=$1`, [req.params.id]); res.json({ok:true});});

router.get('/sequences/:id/steps', async (req,res)=>res.json({ steps:(await pool.query(`SELECT * FROM bi_sequence_steps WHERE sequence_id=$1 ORDER BY step_number`, [req.params.id])).rows }));
router.post('/sequences/:id/steps', async (req,res)=>res.status(201).json({ step:(await pool.query(`INSERT INTO bi_sequence_steps (sequence_id, step_number, delay_days, subject, body_template, send_as_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.params.id, req.body?.step_number, req.body?.delay_days ?? 0, req.body?.subject, req.body?.body_template, req.body?.send_as_user_id ?? null])).rows[0] }));
router.patch('/sequences/:id/steps/:stepId', async (req,res)=>res.json({ step:(await pool.query(`UPDATE bi_sequence_steps SET delay_days=COALESCE($2,delay_days), subject=COALESCE($3,subject), body_template=COALESCE($4,body_template), send_as_user_id=COALESCE($5,send_as_user_id) WHERE id=$1 AND sequence_id=$6 RETURNING *`, [req.params.stepId, req.body?.delay_days ?? null, req.body?.subject ?? null, req.body?.body_template ?? null, req.body?.send_as_user_id ?? null, req.params.id])).rows[0] }));
router.delete('/sequences/:id/steps/:stepId', async (req,res)=>{await pool.query(`DELETE FROM bi_sequence_steps WHERE id=$1 AND sequence_id=$2`, [req.params.stepId, req.params.id]); res.json({ok:true});});

router.post('/sequences/:id/enroll', async (req,res)=>{ const ids=(req.body?.contact_ids||[]) as string[]; const actor = userIdOf(req); const out:any[]=[]; for(const cid of ids){ const cr = await pool.query<any>(`SELECT id, outreach_stage FROM bi_contacts WHERE id=$1 LIMIT 1`, [cid]); const c=cr.rows[0]; if(!c || c.outreach_stage==='disqualified'){ out.push({contact_id:cid, status:'skipped'}); continue;} const ins = await pool.query(`INSERT INTO bi_sequence_enrollments (sequence_id, contact_id, enrolled_by_user_id, next_send_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (sequence_id, contact_id) DO NOTHING RETURNING id`, [req.params.id, cid, actor]); if(!ins.rowCount){ out.push({contact_id:cid,status:'already_enrolled'}); continue;} await pool.query(`INSERT INTO bi_contact_activity (contact_id, actor_user_id, kind, payload) VALUES ($1,$2,'sequence_enrolled',$3::jsonb)`, [cid, actor, JSON.stringify({sequence_id:req.params.id})]); await pool.query(`UPDATE bi_contacts SET outreach_stage='queued' WHERE id=$1 AND outreach_stage='new'`, [cid]); out.push({contact_id:cid,status:'enrolled'});} res.json({results:out}); });

router.post('/sequences/enrollments/:id/pause', async (req,res)=>{await pool.query(`UPDATE bi_sequence_enrollments SET status='paused' WHERE id=$1`, [req.params.id]); res.json({ok:true});});
router.post('/sequences/enrollments/:id/resume', async (req,res)=>{await pool.query(`UPDATE bi_sequence_enrollments SET status='active', next_send_at=COALESCE(next_send_at,NOW()) WHERE id=$1`, [req.params.id]); res.json({ok:true});});
router.post('/sequences/enrollments/:id/stop', async (req,res)=>{await pool.query(`UPDATE bi_sequence_enrollments SET status='stopped', next_send_at=NULL WHERE id=$1`, [req.params.id]); res.json({ok:true});});
router.get('/quotas/me', async (req,res)=>res.json({ quota:(await pool.query(`SELECT * FROM bi_user_send_quotas WHERE user_id=$1`, [userIdOf(req)])).rows[0] ?? null }));
router.get('/quotas', async (_req,res)=>res.json({ quotas:(await pool.query(`SELECT * FROM bi_user_send_quotas ORDER BY updated_at DESC`)).rows }));
router.patch('/quotas/:userId', async (req,res)=>res.json({ quota:(await pool.query(`INSERT INTO bi_user_send_quotas (user_id, daily_limit) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET daily_limit=$2, updated_at=NOW() RETURNING *`, [req.params.userId, req.body?.daily_limit])).rows[0] }));

router.post('/integrations/m365/webhook', async (req,res)=>{ if(Array.isArray(req.body?.value)) await handleGraphReplyWebhook(req.body.value); res.status(202).json({ok:true});});

export default router;
