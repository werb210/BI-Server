DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='bi_requirement_status') THEN
    CREATE TYPE bi_requirement_status AS ENUM ('received','waived','rejected','pending');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bi_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status bi_requirement_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_requirements_application_id ON bi_requirements(application_id);

CREATE TABLE IF NOT EXISTS bi_requirements_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES bi_requirements(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  old_status bi_requirement_status,
  new_status bi_requirement_status NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_requirements_history_req_id ON bi_requirements_history(requirement_id);
