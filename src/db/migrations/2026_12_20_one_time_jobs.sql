-- BI_SERVER_MOVE_BRM_UNSUBSCRIBES_v1 - jobs that run once per database, and what each did.
CREATE TABLE IF NOT EXISTS bi_one_time_jobs (
  name text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  result jsonb
);
