-- BI_SERVER_FLOW_SECOND_ADDRESS_v1 - a contact's second email and phone (a merge keeps the address and number it did not
-- pick here), and a second round of a flow: someone who goes through the never-opened emails without opening one gets the
-- flow again at their second address. round = 1 (first address) or 2; prior_keys = emails already sent to the first one.
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS secondary_email text;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS secondary_phone text;
ALTER TABLE bi_flow_members ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 1;
ALTER TABLE bi_flow_members ADD COLUMN IF NOT EXISTS prior_keys text[] NOT NULL DEFAULT ARRAY[]::text[];
