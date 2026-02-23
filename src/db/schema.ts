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
  `);
}
