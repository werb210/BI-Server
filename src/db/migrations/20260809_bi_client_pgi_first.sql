-- BI_CLIENT_PGI_FIRST_v21
-- PGI is the product Boreal fronts directly and is the lead offer, but the
-- foundation seed gave it sort_order 70 - ninth in the list, below cyber. Pull
-- it to the top for both countries. Idempotent: an UPDATE to a fixed value.
UPDATE bi_products SET sort_order = 5, updated_at = NOW()
 WHERE code = 'pgi' AND sort_order <> 5;
