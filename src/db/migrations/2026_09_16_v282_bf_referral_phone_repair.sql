-- BI_SERVER_BF_PHONE_v282
-- BF-Server sent the applicant's phone as typed in the BF wizard, e.g.
-- "(780) 916-7413". Applicants sign in to BI-Client by E.164 (+17809167413),
-- so every BI application created from a BF referral was invisible to its own
-- applicant, who therefore could not complete or submit it. Convert those
-- stored numbers to E.164. North American numbers only; anything else is left
-- untouched. Safe to re-run.
UPDATE bi_applications a
   SET applicant_phone_e164 = CASE
         WHEN length(d.digits) = 10 THEN '+1' || d.digits
         WHEN length(d.digits) = 11 AND left(d.digits, 1) = '1' THEN '+' || d.digits
         ELSE a.applicant_phone_e164
       END,
       updated_at = NOW()
  FROM (SELECT id, regexp_replace(applicant_phone_e164, '[^0-9]', '', 'g') AS digits
          FROM bi_applications
         WHERE source = 'bf_pgi_referral'
           AND applicant_phone_e164 IS NOT NULL
           AND applicant_phone_e164 !~ '^\+[0-9]{8,15}$') d
 WHERE a.id = d.id
   AND (length(d.digits) = 10 OR (length(d.digits) = 11 AND left(d.digits, 1) = '1'));
