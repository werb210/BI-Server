-- BI_SERVER_ALL_LENDERS_BROKERS_MARKETABLE_v1 (Todd, 2026-11-18): every lender and broker gets the new marketing
-- campaign unless they unsubscribed. 1,139 lender contacts imported in May-June 2026 had been taken off marketing
-- (outreach list removals and "imported" suppressions), so the email flows skipped them.
-- Kept: unsubscribes, spam complaints, bounces and negative replies (each is the person saying no, or an address
-- that does not work), and any "manual" suppression staff added for a person who asked not to be emailed.
-- Runs once (bi_migrations_applied); later staff exclusions are not touched.
UPDATE bi_contacts c
   SET outreach_excluded = FALSE
 WHERE COALESCE(c.outreach_excluded, FALSE) = TRUE
   AND EXISTS (SELECT 1 FROM unnest(COALESCE(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'lender%' OR lower(btrim(t)) LIKE 'broker%');

DELETE FROM bi_suppressions s
 WHERE s.reason = 'imported'
   AND s.channel IN ('email', 'all')
   AND EXISTS (SELECT 1 FROM bi_contacts c
                WHERE (s.contact_id = c.id OR (c.email IS NOT NULL AND lower(s.email) = lower(c.email)))
                  AND EXISTS (SELECT 1 FROM unnest(COALESCE(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'lender%' OR lower(btrim(t)) LIKE 'broker%'));
