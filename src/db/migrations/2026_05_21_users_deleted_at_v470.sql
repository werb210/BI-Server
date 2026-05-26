-- BI_SERVER_BLOCK_v356_QUARANTINE_USERS_MIGRATION_v1
--
-- Add a `deleted_at` soft-delete column to the `users` table.
--
-- Safe-no-op on databases that don't have a `users` table (the bi-server
-- DB doesn't — only BF-Server does). The original body of this file
-- assumed the table existed and failed loudly on bi-server every restart
-- with `relation "users" does not exist`. The DO block below makes the
-- migration idempotent across both deployment targets and silently skips
-- when there's nothing to alter.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'users'
  ) THEN
    -- Real work — only runs on databases that actually have `users`.
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS users_deleted_at_idx
      ON users (deleted_at)
      WHERE deleted_at IS NOT NULL;

    RAISE NOTICE 'v470 users.deleted_at applied';
  ELSE
    RAISE NOTICE 'v470 users.deleted_at skipped (no users table in this DB)';
  END IF;
END
$$;
