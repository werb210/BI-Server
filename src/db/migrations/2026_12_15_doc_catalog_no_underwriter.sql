-- BI_SERVER_NO_UNDERWRITER_NAME_v1 (2026-11-24) - Craig's rule: no insurer or underwriter name in anything staff, lenders or
-- applicants read. The document catalog descriptions said "Purbeck"; they now say PGI. Idempotent (plain UPDATEs).
UPDATE bi_required_doc_catalog SET description = replace(description, 'Required for Canadian (Purbeck) submissions', 'Required for Canadian PGI submissions')
 WHERE description LIKE '%(Purbeck)%';
UPDATE bi_required_doc_catalog SET description = replace(description, 'the Purbeck submission', 'the PGI submission')
 WHERE description LIKE '%Purbeck submission%';
