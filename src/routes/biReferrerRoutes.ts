import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    return res.json({ profile: null, referrals: [] });
  }

  const user = userResult.rows[0];

  const referrerResult = await pool.query(
    `SELECT * FROM bi_referrers WHERE user_id=$1`,
    [user.id]
  );

  if (referrerResult.rows.length === 0) {
    return res.json({ profile: null, referrals: [] });
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

  res.json({
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

  res.json({ success: true });
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

  res.json({ success: true });
});

/* =========================
   ADD REFERRAL
========================= */
router.post("/referrer/add-referral", async (req, res) => {
  const {
    phone,
    company_name,
    full_name,
    email,
    phone: referralPhone
  } = req.body;

  const userResult = await pool.query(
    `SELECT * FROM bi_users WHERE phone_e164=$1 AND user_type='referrer'`,
    [phone]
  );

  if (userResult.rows.length === 0) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const refResult = await pool.query(`SELECT * FROM bi_referrers WHERE user_id=$1`, [userResult.rows[0].id]);

  const referrer = refResult.rows[0];

  if (!referrer.is_active) {
    return res.status(403).json({ error: "Agreement not signed" });
  }

  await pool.query(
    `
    INSERT INTO bi_referrals
    (referrer_id,company_name,full_name,email,phone_e164)
    VALUES($1,$2,$3,$4,$5)
    `,
    [referrer.id, company_name, full_name, email, referralPhone]
  );

  await pool.query(
    `
    INSERT INTO bi_activity(application_id,actor_type,event_type,summary)
    VALUES(NULL,'referrer','referral_created',$1)
    `,
    [`Referral created for ${full_name}`]
  );

  res.json({ success: true });
});

export default router;
