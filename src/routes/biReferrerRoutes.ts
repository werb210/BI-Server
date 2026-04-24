import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const pool = new Pool({ connectionString: env.DATABASE_URL });

/* =========================
   LOAD REFERRER PROFILE
========================= */
router.get("/referrer/profile", async (req, res) => {
  const { phone } = req.query;

  const userResult = await pool.query(
    `SELECT * FROM bi_users WHERE phone_e164=$1 AND user_type='referrer'`,
    [phone]
  );

  if (userResult.rows.length === 0) {
    return ok(res, { profile: null, referrals: [] });
  }

  const user = userResult.rows[0];

  const referrerResult = await pool.query(
    `SELECT * FROM bi_referrers WHERE user_id=$1`,
    [user.id]
  );

  if (referrerResult.rows.length === 0) {
    return ok(res, { profile: null, referrals: [] });
  }

  const referrer = referrerResult.rows[0];

  const referrals = await pool.query(
    `
    SELECT 
      id,
      company_name,
      full_name,
      application_created,
      CASE 
        WHEN application_created THEN 'Application Submitted'
        ELSE 'Pending'
      END as status
    FROM bi_referrals
    WHERE referrer_id=$1
    ORDER BY created_at DESC
    `,
    [referrer.id]
  );

  ok(res, {
    profile: {
      is_active: referrer.is_active,
      agreement_status: referrer.agreement_status
    },
    referrals: referrals.rows
  });
});

/* =========================
   REQUEST AGREEMENT (SIGNNOW STUB)
========================= */
router.post("/referrer/request-agreement", async (req, res) => {
  const { phone } = req.body;

  const userResult = await pool.query(`SELECT * FROM bi_users WHERE phone_e164=$1`, [phone]);

  let user;

  if (userResult.rows.length === 0) {
    const created = await pool.query(
      `INSERT INTO bi_users(phone_e164,user_type)
       VALUES($1,'referrer')
       RETURNING *`,
      [phone]
    );
    user = created.rows[0];
  } else {
    user = userResult.rows[0];
  }

  const refResult = await pool.query(`SELECT * FROM bi_referrers WHERE user_id=$1`, [user.id]);

  let referrer;

  if (refResult.rows.length === 0) {
    const createdRef = await pool.query(
      `
      INSERT INTO bi_referrers(user_id,company_name,full_name,email,phone_e164,agreement_status)
      VALUES($1,'Pending','Pending','pending@email.com',$2,'sent')
      RETURNING *
      `,
      [user.id, phone]
    );
    referrer = createdRef.rows[0];
  } else {
    referrer = refResult.rows[0];
  }

  // Stub SignNow document creation
  await pool.query(
    `
    INSERT INTO bi_referrer_agreements
    (referrer_id,template_id,status,sent_at)
    VALUES($1,'BI_REFERRER_TEMPLATE','sent',NOW())
    `,
    [referrer.id]
  );

  await pool.query(
    `
    UPDATE bi_referrers
    SET agreement_status='sent'
    WHERE id=$1
    `,
    [referrer.id]
  );

  ok(res, { success: true });
});

/* =========================
   MARK AGREEMENT SIGNED (Webhook-ready)
========================= */
router.post("/referrer/agreement-signed", async (req, res) => {
  const { referrerId } = req.body;

  await pool.query(
    `
    UPDATE bi_referrer_agreements
    SET status='signed',
        signed_at=NOW()
    WHERE referrer_id=$1
    `,
    [referrerId]
  );

  await pool.query(
    `
    UPDATE bi_referrers
    SET agreement_status='signed',
        is_active=TRUE
    WHERE id=$1
    `,
    [referrerId]
  );

  ok(res, { success: true });
});

function getUserId(req: unknown): string | null {
  const u = (req as { user?: { staffUserId?: string } }).user;
  return u?.staffUserId ?? null;
}

router.post("/referrer/profile", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return badRequest(res, "Unauthorized");

  const { full_name, company_name, email, phone } = req.body as {
    full_name?: string;
    company_name?: string;
    email?: string;
    phone?: string;
  };

  if (!full_name || !company_name || !email || !phone) {
    return badRequest(res, "Name, company, email, and mobile are required");
  }

  await pool.query(
    `INSERT INTO bi_referrers(user_id, company_name, full_name, email, phone_e164, is_active)
     VALUES($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (user_id) DO UPDATE SET
       company_name = EXCLUDED.company_name,
       full_name = EXCLUDED.full_name,
       email = EXCLUDED.email,
       phone_e164 = EXCLUDED.phone_e164,
       is_active = TRUE`,
    [userId, company_name, full_name, email, phone]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
     VALUES(NULL, 'referrer', $1, 'referrer_profile_complete', 'Referrer profile completed', $2::jsonb)`,
    [userId, JSON.stringify({ full_name, company_name, email, phone })]
  );

  return ok(res, { success: true });
});

router.get("/referrer/me", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return badRequest(res, "Unauthorized");
  const r = await pool.query(`SELECT * FROM bi_referrers WHERE user_id=$1`, [userId]);
  return ok(res, { profile: r.rows[0] ?? null });
});

router.post("/referrer/add-referral", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return badRequest(res, "Unauthorized");

  const { company_name, full_name, email, phone } = req.body as {
    company_name?: string;
    full_name?: string;
    email?: string;
    phone?: string;
  };
  const referralPhone = phone;

  if (!full_name || !referralPhone) {
    return badRequest(res, "full_name and phone are required");
  }

  const refRow = await pool.query(`SELECT id FROM bi_referrers WHERE user_id=$1`, [userId]);
  if (!refRow.rows.length) return badRequest(res, "Referrer profile not found");

  const inserted = await pool.query(
    `INSERT INTO bi_referrals(referrer_id, company_name, full_name, email, phone_e164)
     VALUES($1, $2, $3, $4, $5) RETURNING id`,
    [refRow.rows[0].id, company_name || null, full_name, email || null, referralPhone]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
     VALUES(NULL, 'referrer', $1, 'referral_created', $2, $3::jsonb)`,
    [
      userId,
      `Referral created for ${full_name}`,
      JSON.stringify({
        referralId: inserted.rows[0].id,
        company_name,
        full_name,
        email,
        phone: referralPhone
      })
    ]
  );

  return ok(res, { success: true, referralId: inserted.rows[0].id });
});

router.get("/referrer/pipeline", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return badRequest(res, "Unauthorized");

  const refRow = await pool.query(`SELECT id FROM bi_referrers WHERE user_id=$1`, [userId]);
  if (!refRow.rows.length) return ok(res, { referrals: [] });

  const rows = await pool.query(
    `SELECT rr.id, rr.full_name, rr.company_name, rr.email, rr.phone_e164, rr.created_at,
            a.id AS application_id,
            a.stage AS application_stage
       FROM bi_referrals rr
  LEFT JOIN bi_contacts c ON c.phone_e164 = rr.phone_e164
  LEFT JOIN bi_applications a ON a.primary_contact_id = c.id
      WHERE rr.referrer_id = $1
      ORDER BY rr.created_at DESC`,
    [refRow.rows[0].id]
  );

  return ok(res, { referrals: rows.rows });
});

export default router;
