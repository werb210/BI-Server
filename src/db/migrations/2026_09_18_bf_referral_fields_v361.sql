-- BI_SERVER_BF_REFERRAL_FIELDS_v361
-- Existing BF referrals: move the business number out of data into its column and
-- give guarantor_phone the phone the applicant signs in with. Idempotent.
UPDATE bi_applications
   SET business_number = data->>'business_number', updated_at = NOW()
 WHERE source = 'bf_pgi_referral'
   AND COALESCE(business_number, '') = ''
   AND COALESCE(data->>'business_number', '') <> '';

UPDATE bi_applications
   SET guarantor_phone = applicant_phone_e164, updated_at = NOW()
 WHERE source = 'bf_pgi_referral'
   AND COALESCE(guarantor_phone, '') = ''
   AND COALESCE(applicant_phone_e164, '') <> '';
