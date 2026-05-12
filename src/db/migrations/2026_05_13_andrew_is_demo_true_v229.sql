-- BI_SERVER_BLOCK_v229_ANDREW_IS_DEMO_TRUE_v1
-- Andrew is running sales demos — flip his is_demo flag to TRUE so the
-- carrier-skip path in biLenderApplicationCreate fires for everything he
-- submits. Insert the row if it doesn't exist yet (handles the case where
-- v228 was edited or never applied).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bi_lenders WHERE contact_phone_e164 = '+17802648467') THEN
    INSERT INTO bi_lenders (
      company_name, contact_full_name, contact_phone_e164,
      country, is_active, is_demo
    ) VALUES (
      'Boreal Financial', 'Andrew', '+17802648467',
      'CA', TRUE, TRUE
    );
  ELSE
    UPDATE bi_lenders
       SET is_demo   = TRUE,
           is_active = TRUE
     WHERE contact_phone_e164 = '+17802648467';
  END IF;
END $$;
