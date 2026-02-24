-- BI-SERVER MASTER SCHEMA
-- Retention:
-- - docs purged after completion via scheduled job (buffer)
-- - application metadata + logs retained 7 years

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- ENUMS
-- =========================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bi_pipeline_stage') THEN
    CREATE TYPE bi_pipeline_stage AS ENUM (
      'new_application',
      'documents_pending',
      'under_review',
      'approved',
      'declined',
      'policy_issued'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bi_actor_type') THEN
    CREATE TYPE bi_actor_type AS ENUM ('applicant', 'lender', 'referrer', 'staff', 'system');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bi_document_type') THEN
    CREATE TYPE bi_document_type AS ENUM (
      'loan_agreement_signed',
      'personal_guarantee_copy',
      'financial_statements',
      'proof_of_id',
      'corporate_registration_docs',
      'id_verification',
      'enforcement_notice'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bi_referrer_agreement_status') THEN
    CREATE TYPE bi_referrer_agreement_status AS ENUM (
      'not_sent',
      'sent',
      'viewed',
      'signed',
      'declined',
      'expired'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bi_commission_status') THEN
    CREATE TYPE bi_commission_status AS ENUM (
      'not_applicable',
      'estimated',
      'payable',
      'paid',
      'void'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bi_packaging_status') THEN
    CREATE TYPE bi_packaging_status AS ENUM (
      'not_sent',
      'ready_to_send',
      'sent_to_purbeck',
      'purbeck_approved',
      'purbeck_declined'
    );
  END IF;
END $$;

-- =========================
-- USERS (PHONE IDENTITY)
-- =========================
CREATE TABLE IF NOT EXISTS bi_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT UNIQUE NOT NULL,
  user_type bi_actor_type NOT NULL CHECK (user_type IN ('applicant','lender','referrer')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_users_type ON bi_users(user_type);

-- =========================
-- OTP SESSIONS (TWILIO)
-- =========================
CREATE TABLE IF NOT EXISTS bi_otp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','resume_application')),
  otp_provider TEXT NOT NULL DEFAULT 'twilio',
  provider_sid TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  requested_ip INET,
  user_agent TEXT,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bi_otp_phone ON bi_otp_sessions(phone_e164);
CREATE INDEX IF NOT EXISTS idx_bi_otp_verified ON bi_otp_sessions(verified);

-- =========================
-- CONSENT / COMPLIANCE LOGS (7 YEARS)
-- =========================
CREATE TABLE IF NOT EXISTS bi_consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL,
  ip INET,
  user_agent TEXT,
  consent_checked BOOLEAN NOT NULL,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_consent_phone ON bi_consent_logs(phone_e164);
CREATE INDEX IF NOT EXISTS idx_bi_consent_created ON bi_consent_logs(created_at);

-- =========================
-- LENDERS (LENDER REPS)
-- =========================
CREATE TABLE IF NOT EXISTS bi_lenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES bi_users(id) ON DELETE RESTRICT,
  company_name TEXT,
  rep_full_name TEXT,
  rep_email TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================
-- REFERRERS
-- =========================
CREATE TABLE IF NOT EXISTS bi_referrers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES bi_users(id) ON DELETE RESTRICT,
  company_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  agreement_status bi_referrer_agreement_status NOT NULL DEFAULT 'not_sent',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_referrers_active ON bi_referrers(is_active);
CREATE INDEX IF NOT EXISTS idx_bi_referrers_email ON bi_referrers(email);

-- =========================
-- REFERRER AGREEMENTS (SIGNNOW-STYLE)
-- =========================
CREATE TABLE IF NOT EXISTS bi_referrer_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES bi_referrers(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  request_id TEXT,
  signnow_document_id TEXT,
  signing_link TEXT,
  status bi_referrer_agreement_status NOT NULL DEFAULT 'not_sent',
  sent_at TIMESTAMP,
  signed_at TIMESTAMP,
  expired_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_ref_agreement_referrer ON bi_referrer_agreements(referrer_id);
CREATE INDEX IF NOT EXISTS idx_bi_ref_agreement_status ON bi_referrer_agreements(status);

-- =========================
-- REFERRALS (LEADS SUBMITTED BY REFERRERS)
-- =========================
CREATE TABLE IF NOT EXISTS bi_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES bi_referrers(id) ON DELETE RESTRICT,
  company_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone_e164 TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY['referral']::TEXT[],
  application_created BOOLEAN NOT NULL DEFAULT FALSE,
  application_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_referrals_referrer ON bi_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_bi_referrals_created ON bi_referrals(created_at);

-- =========================
-- COMPANIES / CONTACTS (BI CRM)
-- =========================
CREATE TABLE IF NOT EXISTS bi_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  operating_name TEXT,
  business_number TEXT,
  address_line1 TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  industry TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bi_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES bi_companies(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone_e164 TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_contacts_company ON bi_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_bi_contacts_phone ON bi_contacts(phone_e164);

-- =========================
-- APPLICATIONS
-- =========================
CREATE TABLE IF NOT EXISTS bi_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_actor bi_actor_type NOT NULL,
  created_by_user_id UUID REFERENCES bi_users(id) ON DELETE SET NULL,
  created_by_lender_id UUID REFERENCES bi_lenders(id) ON DELETE SET NULL,
  company_id UUID REFERENCES bi_companies(id) ON DELETE SET NULL,
  primary_contact_id UUID REFERENCES bi_contacts(id) ON DELETE SET NULL,
  referrer_id UUID REFERENCES bi_referrers(id) ON DELETE SET NULL,
  referral_id UUID REFERENCES bi_referrals(id) ON DELETE SET NULL,
  applicant_phone_e164 TEXT NOT NULL,
  stage bi_pipeline_stage NOT NULL DEFAULT 'new_application',
  packaging_status bi_packaging_status NOT NULL DEFAULT 'not_sent',
  bankruptcy_flag BOOLEAN NOT NULL DEFAULT FALSE,
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  premium_calc JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_app_stage ON bi_applications(stage);
CREATE INDEX IF NOT EXISTS idx_bi_app_phone ON bi_applications(applicant_phone_e164);
CREATE INDEX IF NOT EXISTS idx_bi_app_created ON bi_applications(created_at);
CREATE INDEX IF NOT EXISTS idx_bi_app_lender ON bi_applications(created_by_lender_id);
CREATE INDEX IF NOT EXISTS idx_bi_app_referrer ON bi_applications(referrer_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name='bi_referrals' AND column_name='application_id'
  ) THEN
    ALTER TABLE bi_referrals
      ADD CONSTRAINT fk_bi_referrals_application
      FOREIGN KEY (application_id) REFERENCES bi_applications(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =========================
-- DOCUMENTS (PURGED AFTER COMPLETION VIA JOB)
-- =========================
CREATE TABLE IF NOT EXISTS bi_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  doc_type bi_document_type NOT NULL,
  original_filename TEXT,
  storage_key TEXT,
  mime_type TEXT,
  bytes BIGINT,
  uploaded_by_actor bi_actor_type NOT NULL,
  uploaded_by_user_id UUID REFERENCES bi_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  purged_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bi_docs_app ON bi_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_bi_docs_type ON bi_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_bi_docs_purged ON bi_documents(purged_at);

CREATE TABLE IF NOT EXISTS bi_purge_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID UNIQUE NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  eligible_at TIMESTAMP NOT NULL,
  purged_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_purge_eligible ON bi_purge_queue(eligible_at);

-- =========================
-- COMMISSION LEDGER (BI SILO ONLY)
-- =========================
CREATE TABLE IF NOT EXISTS bi_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID UNIQUE NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  annual_premium_amount NUMERIC(14,2),
  commission_rate NUMERIC(6,4) NOT NULL DEFAULT 0.10,
  commission_amount NUMERIC(14,2),
  status bi_commission_status NOT NULL DEFAULT 'estimated',
  premium_received_at TIMESTAMP,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_comm_status ON bi_commissions(status);
CREATE INDEX IF NOT EXISTS idx_bi_comm_premium_received ON bi_commissions(premium_received_at);

-- =========================
-- ACTIVITY TIMELINE (NEWEST ON TOP)
-- =========================
CREATE TABLE IF NOT EXISTS bi_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES bi_applications(id) ON DELETE CASCADE,
  actor_type bi_actor_type NOT NULL,
  actor_user_id UUID REFERENCES bi_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_activity_app ON bi_activity(application_id);
CREATE INDEX IF NOT EXISTS idx_bi_activity_created ON bi_activity(created_at);

-- =========================
-- EMAIL RELAY LOGS (LENDER ↔ STAFF)
-- =========================
CREATE TABLE IF NOT EXISTS bi_email_relay (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES bi_applications(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body_preview TEXT,
  provider_message_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_email_relay_app ON bi_email_relay(application_id);
CREATE INDEX IF NOT EXISTS idx_bi_email_relay_created ON bi_email_relay(created_at);

-- =========================
-- CONTACT LEADS (BI WEBSITE)
-- =========================
CREATE TABLE IF NOT EXISTS bi_contact_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_e164 TEXT,
  message TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY['contact_lead']::TEXT[],
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_contact_leads_created ON bi_contact_leads(created_at);

-- =========================
-- SIMPLE "UPDATED_AT" TRIGGER HELPERS
-- =========================
CREATE OR REPLACE FUNCTION bi_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_bi_users_updated_at') THEN
    CREATE TRIGGER trg_bi_users_updated_at
    BEFORE UPDATE ON bi_users
    FOR EACH ROW EXECUTE FUNCTION bi_set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_bi_applications_updated_at') THEN
    CREATE TRIGGER trg_bi_applications_updated_at
    BEFORE UPDATE ON bi_applications
    FOR EACH ROW EXECUTE FUNCTION bi_set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_bi_commissions_updated_at') THEN
    CREATE TRIGGER trg_bi_commissions_updated_at
    BEFORE UPDATE ON bi_commissions
    FOR EACH ROW EXECUTE FUNCTION bi_set_updated_at();
  END IF;
END $$;
