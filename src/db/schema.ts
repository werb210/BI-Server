import { pool } from "./index";

export async function runSchema() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS bi_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source TEXT NOT NULL,
      status TEXT DEFAULT 'quote_started',
      email TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID REFERENCES bi_leads(id),
      personal_data JSONB NOT NULL,
      company_data JSONB NOT NULL,
      guarantee_data JSONB NOT NULL,
      declarations JSONB NOT NULL,
      consent_data JSONB NOT NULL,
      quote_result JSONB,
      status TEXT DEFAULT 'draft',
      submitted_at TIMESTAMP,
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
