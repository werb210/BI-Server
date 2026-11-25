-- BI_SERVER_ALL_LENDERS_BROKERS_MARKETABLE_v2 (Todd, 2026-11-25): every lender and broker gets the marketing emails
-- unless they unsubscribed. About 740 lenders imported in May-June 2026 were still off marketing (an outreach
-- exclusion or a suppression that is not the person saying no), so the email flows skipped them.
-- Kept: unsubscribes, spam complaints, bounces, negative replies, manual staff suppressions and deleted contacts.
-- Safe to run again.
UPDATE bi_contacts c
   SET outreach_excluded = FALSE
 WHERE COALESCE(c.outreach_excluded, FALSE) = TRUE
   AND EXISTS (SELECT 1 FROM unnest(COALESCE(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'lender%' OR lower(btrim(t)) LIKE 'broker%');

DELETE FROM bi_suppressions s
 WHERE s.channel IN ('email', 'all')
   AND lower(coalesce(s.reason, '')) NOT IN ('unsubscribe', 'sendgrid_unsubscribe', 'sendgrid_group_unsubscribe', 'bounce', 'sendgrid_bounce',
                                             'complaint', 'spamreport', 'spam_report', 'sendgrid_spam_report', 'reply_negative', 'manual', 'deleted_from_crm')
   AND EXISTS (SELECT 1 FROM bi_contacts c
                WHERE (s.contact_id = c.id OR (c.email IS NOT NULL AND (lower(s.email) = lower(c.email) OR lower(s.identifier) = lower(c.email))))
                  AND EXISTS (SELECT 1 FROM unnest(COALESCE(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'lender%' OR lower(btrim(t)) LIKE 'broker%'));
