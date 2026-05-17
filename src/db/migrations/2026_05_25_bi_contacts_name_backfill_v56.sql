-- BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1
-- Backfill bi_contacts.full_name where the placeholder "Applicant +<phone>"
-- was inserted before this block. Pulls the real guarantor_name from any
-- linked bi_applications row (most recent wins). Idempotent: only updates
-- rows that still match the placeholder pattern.

UPDATE bi_contacts c
   SET full_name = sub.guarantor_name,
       email     = COALESCE(c.email, sub.guarantor_email)
  FROM (
    SELECT DISTINCT ON (a.guarantor_phone)
           a.guarantor_phone,
           NULLIF(TRIM(a.guarantor_name), '')   AS guarantor_name,
           NULLIF(TRIM(a.guarantor_email), '')  AS guarantor_email
      FROM bi_applications a
     WHERE a.guarantor_phone IS NOT NULL
       AND NULLIF(TRIM(a.guarantor_name), '') IS NOT NULL
     ORDER BY a.guarantor_phone, a.created_at DESC
  ) sub
 WHERE c.phone_e164 = sub.guarantor_phone
   AND (c.full_name LIKE 'Applicant +%' OR c.full_name LIKE 'New applicant (%');
