import { pool } from "./index";

export async function runSchema() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS bi_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source TEXT NOT NULL,
      status TEXT DEFAULT 'quote_started',
      channel TEXT DEFAULT 'direct',
      referrer_id UUID,
      lender_origin BOOLEAN DEFAULT false,
      email TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE bi_leads
      ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'direct',
      ADD COLUMN IF NOT EXISTS referrer_id UUID,
      ADD COLUMN IF NOT EXISTS lender_origin BOOLEAN DEFAULT false;

    CREATE TABLE IF NOT EXISTS bi_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID REFERENCES bi_leads(id),
      personal_data JSONB NOT NULL,
      company_data JSONB NOT NULL,
      guarantee_data JSONB NOT NULL,
      declarations JSONB NOT NULL,
      consent_data JSONB NOT NULL,
      quote_result JSONB,
      status TEXT CHECK (
        status IN (
          'quote_started',
          'submitted',
          'referred',
          'under_review',
          'approved',
          'active',
          'declined',
          'cancelled',
          'claim'
        )
      ) DEFAULT 'quote_started',
      submitted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    DO $$
    DECLARE
      constraint_name TEXT;
    BEGIN
      SELECT conname INTO constraint_name
      FROM pg_constraint
      WHERE conrelid = 'bi_applications'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%status%';

      IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE bi_applications DROP CONSTRAINT %I', constraint_name);
      END IF;
    END $$;

    ALTER TABLE bi_applications
      ALTER COLUMN status TYPE TEXT,
      ALTER COLUMN status SET DEFAULT 'quote_started';

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'bi_applications'::regclass
          AND conname = 'bi_applications_status_check'
      ) THEN
        ALTER TABLE bi_applications
          ADD CONSTRAINT bi_applications_status_check CHECK (
            status IN (
              'quote_started',
              'submitted',
              'referred',
              'under_review',
              'approved',
              'active',
              'declined',
              'cancelled',
              'claim'
            )
          );
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS bi_referrers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT,
      email TEXT,
      commission_rate NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_commissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id UUID REFERENCES bi_applications(id),
      commission_type TEXT,
      commission_rate NUMERIC,
      premium_amount NUMERIC,
      commission_amount NUMERIC,
      status TEXT DEFAULT 'expected',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT,
      entity_id UUID,
      event_type TEXT,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id UUID REFERENCES bi_applications(id),
      policy_number TEXT UNIQUE,
      premium_amount NUMERIC,
      start_date DATE,
      end_date DATE,
      status TEXT CHECK (
        status IN ('active','cancelled','expired','claim')
      ) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );

    DO $$
    DECLARE
      existing_fk TEXT;
    BEGIN
      SELECT conname INTO existing_fk
      FROM pg_constraint
      WHERE conrelid = 'bi_policies'::regclass
        AND contype = 'f'
        AND conname = 'fk_application';

      IF existing_fk IS NOT NULL THEN
        ALTER TABLE bi_policies DROP CONSTRAINT fk_application;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'bi_policies'::regclass
          AND contype = 'f'
          AND conname = 'fk_application'
      ) THEN
        ALTER TABLE bi_policies
          ADD CONSTRAINT fk_application
          FOREIGN KEY (application_id)
          REFERENCES bi_applications(id)
          ON DELETE RESTRICT;
      END IF;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_policy_number
      ON bi_policies(policy_number);

    CREATE INDEX IF NOT EXISTS idx_policy_status ON bi_policies(status);

    CREATE TABLE IF NOT EXISTS bi_premium_schedule (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id UUID REFERENCES bi_policies(id),
      due_date DATE,
      premium_amount NUMERIC,
      paid BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_schedule_due ON bi_premium_schedule(due_date);

    CREATE TABLE IF NOT EXISTS bi_payout_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT CHECK (status IN ('open','closed','paid')) DEFAULT 'open',
      total_amount NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      paid_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bi_commission_payables (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id UUID REFERENCES bi_policies(id) ON DELETE RESTRICT,
      premium_schedule_id UUID REFERENCES bi_premium_schedule(id) ON DELETE RESTRICT,
      referrer_id UUID REFERENCES bi_referrers(id) ON DELETE RESTRICT,
      gross_premium NUMERIC NOT NULL,
      commission_rate NUMERIC NOT NULL,
      commission_amount NUMERIC NOT NULL,
      status TEXT CHECK (status IN ('earned','batched','paid')) DEFAULT 'earned',
      payout_batch_id UUID,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_commission_status
      ON bi_commission_payables(status);

    CREATE INDEX IF NOT EXISTS idx_batch_status
      ON bi_payout_batches(status);

    CREATE TABLE IF NOT EXISTS bi_claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id UUID REFERENCES bi_policies(id),
      claim_amount NUMERIC,
      claim_status TEXT CHECK (
        claim_status IN ('submitted','under_review','approved','rejected','paid')
      ) DEFAULT 'submitted',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_claim_status ON bi_claims(claim_status);

    CREATE TABLE IF NOT EXISTS bi_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT,
      entity_id UUID,
      transaction_type TEXT,
      amount NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE bi_ledger
      ALTER COLUMN amount SET NOT NULL;


    CREATE TABLE IF NOT EXISTS bi_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_type TEXT NOT NULL,
      status TEXT CHECK (status IN ('pending','running','completed','failed')) DEFAULT 'pending',
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_job_locks (
      job_name TEXT PRIMARY KEY,
      locked_at TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_type ON bi_jobs(job_type);

    CREATE TABLE IF NOT EXISTS bi_idempotency (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION prevent_ledger_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'Ledger rows are immutable';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS no_delete_ledger ON bi_ledger;

    CREATE TRIGGER no_delete_ledger
    BEFORE DELETE ON bi_ledger
    FOR EACH ROW
    EXECUTE FUNCTION prevent_ledger_delete();
  `);
}
