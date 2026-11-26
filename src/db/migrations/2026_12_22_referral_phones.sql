-- BI_SERVER_REFERRAL_PHONES_v1 - colleagues added from out-of-office replies kept the phone number the reply gave only in
-- their note. Copy a North American number from the note into phone_e164 so they can be called and texted from the CRM.
UPDATE bi_contacts c
   SET phone_e164 = CASE WHEN length(x.d) = 10 THEN '+1' || x.d ELSE '+' || x.d END,
       updated_at = now()
  FROM (
    SELECT id, regexp_replace(substring(notes from 'phone given: (.*)\)\.?\s*$'), '\D', '', 'g') AS d
      FROM bi_contacts
     WHERE source_first = 'auto-reply referral' AND phone_e164 IS NULL AND notes LIKE '%phone given:%'
  ) x
 WHERE c.id = x.id AND c.phone_e164 IS NULL
   AND ((length(x.d) = 10 AND x.d ~ '^[2-9]') OR (length(x.d) = 11 AND x.d ~ '^1[2-9]'));
