--
-- PostgreSQL database dump
--

\restrict 5H44LPpZ2vn50qsdC7I8cdMWbvIO8y7vacnkH2QnjEuNSZSfjnV9lzRcNxGL87B

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: bi_actor_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bi_actor_type AS ENUM (
    'applicant',
    'lender',
    'referrer',
    'staff',
    'system'
);


--
-- Name: bi_commission_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bi_commission_status AS ENUM (
    'not_applicable',
    'estimated',
    'payable',
    'paid',
    'void'
);


--
-- Name: bi_document_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bi_document_type AS ENUM (
    'loan_agreement_signed',
    'personal_guarantee_copy',
    'financial_statements',
    'proof_of_id',
    'corporate_registration_docs',
    'id_verification',
    'enforcement_notice',
    'other',
    'profit_loss',
    'balance_sheet',
    'ar_aging',
    'ap_aging',
    'founder_cv',
    'financial_forecast',
    'pl_12mo',
    'forecast',
    'gov_id_primary',
    'gov_id_secondary',
    'annual_y1',
    'annual_y2',
    'annual_y3',
    'annual_financials_3yr',
    'loan_agreement',
    'subcontract_agreement',
    'certificate_of_insurance',
    'carrier_application'
);


--
-- Name: bi_ocr_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bi_ocr_status AS ENUM (
    'pending',
    'processing',
    'complete',
    'failed',
    'skipped'
);


--
-- Name: bi_packaging_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bi_packaging_status AS ENUM (
    'not_sent',
    'ready_to_send',
    'sent_to_purbeck',
    'purbeck_approved',
    'purbeck_declined'
);


--
-- Name: bi_pipeline_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bi_pipeline_stage AS ENUM (
    'new_application',
    'documents_pending',
    'under_review',
    'approved',
    'declined',
    'policy_issued',
    'quoted',
    'bound',
    'claim',
    'submitted'
);


--
-- Name: bi_referrer_agreement_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bi_referrer_agreement_status AS ENUM (
    'not_sent',
    'sent',
    'viewed',
    'signed',
    'declined',
    'expired'
);


--
-- Name: bi_requirement_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bi_requirement_status AS ENUM (
    'received',
    'waived',
    'rejected',
    'pending'
);


--
-- Name: bi_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bi_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: bi_stage_from_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bi_stage_from_status(s text) RETURNS public.bi_pipeline_stage
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN CASE
    WHEN s IS NULL THEN 'new_application'::bi_pipeline_stage
    WHEN s = '' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'created' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'in_progress' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'new_application' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'ready_for_submission' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'document_review' THEN 'documents_pending'::bi_pipeline_stage
    WHEN s = 'submitted' THEN 'submitted'::bi_pipeline_stage
    WHEN s = 'under_review' THEN 'under_review'::bi_pipeline_stage
    WHEN s = 'information_required' THEN 'under_review'::bi_pipeline_stage
    WHEN s = 'approved' THEN 'under_review'::bi_pipeline_stage
    WHEN s = 'declined' THEN 'declined'::bi_pipeline_stage
    WHEN s = 'policy_issued' THEN 'bound'::bi_pipeline_stage
    ELSE NULL
  END;
END;
$$;


--
-- Name: bi_sync_stage_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bi_sync_stage_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE mapped bi_pipeline_stage;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    mapped := bi_stage_from_status(NEW.status);
    IF mapped IS NOT NULL THEN NEW.stage := mapped; END IF;
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: admin_login_security; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_login_security (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    failed_attempts integer DEFAULT 0,
    locked_until timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: admin_otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    code text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    is_active boolean DEFAULT true,
    failed_attempts integer DEFAULT 0,
    locked_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    role text DEFAULT 'admin'::text
);


--
-- Name: bi_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    actor_type public.bi_actor_type NOT NULL,
    actor_user_id uuid,
    event_type text NOT NULL,
    summary text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    contact_id uuid
);


--
-- Name: bi_apollo_email_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_apollo_email_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    apollo_account_id text NOT NULL,
    email text NOT NULL,
    daily_send_count integer DEFAULT 0 NOT NULL,
    daily_send_date date,
    bounce_rate_30d numeric(5,4),
    reply_rate_30d numeric(5,4),
    status text DEFAULT 'unknown'::text NOT NULL,
    raw_data jsonb,
    last_synced_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_apollo_enrichment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_apollo_enrichment (
    contact_id uuid NOT NULL,
    apollo_person_id text,
    email text,
    title text,
    linkedin_url text,
    company_name text,
    company_domain text,
    seniority text,
    raw_json jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'apollo'::text NOT NULL
);


--
-- Name: bi_apollo_enrollment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_apollo_enrollment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    sequence_id uuid NOT NULL,
    apollo_contact_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    enrolled_by text,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
    last_event_at timestamp with time zone,
    last_event text,
    raw_json jsonb,
    CONSTRAINT bi_apollo_enrollment_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'paused'::text, 'replied'::text, 'bounced'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: bi_apollo_sequence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_apollo_sequence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    apollo_sequence_id text,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    raw_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_apollo_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_apollo_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    apollo_sequence_id text NOT NULL,
    name text NOT NULL,
    icp_segment text,
    owner_user_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    last_synced_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_apollo_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_apollo_sync_state (
    id integer DEFAULT 1 NOT NULL,
    last_contact_sync_at timestamp without time zone,
    last_engagement_sync_at timestamp without time zone,
    last_run_status text,
    last_run_message text,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    last_email_account_sync_at timestamp without time zone,
    last_sequence_sync_at timestamp without time zone,
    CONSTRAINT bi_apollo_sync_state_singleton CHECK ((id = 1))
);


--
-- Name: bi_applicant_device_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_applicant_device_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_e164 text NOT NULL,
    secret_hash text NOT NULL,
    device_label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '180 days'::interval) NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: bi_application_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_application_answers (
    application_id uuid NOT NULL,
    question_key text NOT NULL,
    value text,
    reason text,
    answered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_application_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_application_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    product_id uuid NOT NULL,
    source text DEFAULT 'contract'::text NOT NULL,
    stage text DEFAULT 'selected'::text NOT NULL,
    carrier text,
    premium numeric(12,2),
    policy_id uuid,
    decline_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_application_products_source_check CHECK ((source = ANY (ARRAY['contract'::text, 'recommended'::text, 'client_added'::text])))
);


--
-- Name: bi_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by_actor public.bi_actor_type NOT NULL,
    created_by_user_id uuid,
    created_by_lender_id uuid,
    company_id uuid,
    primary_contact_id uuid,
    referrer_id uuid,
    referral_id uuid,
    applicant_phone_e164 text,
    stage public.bi_pipeline_stage DEFAULT 'new_application'::public.bi_pipeline_stage NOT NULL,
    packaging_status public.bi_packaging_status DEFAULT 'not_sent'::public.bi_packaging_status NOT NULL,
    bankruptcy_flag boolean DEFAULT false NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    premium_calc jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    directors jsonb,
    has_bankruptcy boolean DEFAULT false,
    has_existing_pg boolean DEFAULT false,
    existing_pg_amount numeric,
    has_previous_claims boolean DEFAULT false,
    first_name text,
    last_name text,
    secured_type text,
    commission numeric,
    annual_premium numeric,
    boreal_commission numeric,
    coverage_amount numeric,
    pgi_external_id text,
    quote_summary jsonb,
    quote_expiry_at timestamp without time zone,
    underwriter_ref text,
    lender_name text,
    guarantor_name text,
    guarantor_email text,
    core_score numeric,
    source_type text DEFAULT 'public'::text NOT NULL,
    docs_review_required boolean DEFAULT true NOT NULL,
    signed_at timestamp without time zone,
    signature_data jsonb,
    submission_locked boolean DEFAULT false NOT NULL,
    status text,
    status_legacy text,
    form_data jsonb,
    country text,
    naics_code text,
    formation_date date,
    loan_amount numeric(14,2),
    pgi_limit numeric(14,2),
    annual_revenue numeric(14,2),
    ebitda numeric(14,2),
    total_debt numeric(14,2),
    monthly_debt_service numeric(14,2),
    collateral_value numeric(14,2),
    enterprise_value numeric(14,2),
    bankruptcy_history boolean,
    insolvency_history boolean,
    judgment_history boolean,
    business_name text,
    facility_type text,
    coverage_percentage numeric(5,4),
    score_id text,
    score_value integer,
    score_decision text,
    score_reason text,
    score_at timestamp with time zone,
    pgi_application_id text,
    quote_id text,
    quote_valid_until timestamp with time zone,
    source text,
    lender_id uuid,
    public_id text,
    guarantor_dob date,
    guarantor_address text,
    guarantor_phone text,
    business_address text,
    business_website text,
    entity_type text,
    business_number text,
    csbfp_backed boolean,
    loan_has_guaranteed_cap boolean,
    loan_funding_date date,
    loan_purpose text,
    personally_guaranteeing boolean,
    has_other_guarantors boolean,
    policy_start_date date,
    payables_threatening boolean,
    upcoming_adverse_events boolean,
    personal_investigations boolean,
    business_investigations boolean,
    property_insurance_in_force boolean,
    personal_judgments boolean,
    business_judgments boolean,
    consents jsonb,
    score_stale boolean DEFAULT false NOT NULL,
    policy_id text,
    policy_bound_at timestamp with time zone,
    carrier_received_at timestamp with time zone,
    carrier_last_event text,
    carrier_last_event_at timestamp with time zone,
    carrier_submission_request jsonb,
    carrier_submission_response jsonb,
    carrier_submission_error text,
    is_demo boolean DEFAULT false NOT NULL,
    application_code text,
    docs_deferred_at timestamp with time zone,
    doc_reminder_count integer DEFAULT 0 NOT NULL,
    last_doc_reminder_at timestamp with time zone,
    referrer_code text,
    created_by_lender_user_id uuid,
    core_inputs jsonb,
    bf_application_id text,
    naics_confidence boolean,
    lender_company_id uuid,
    lender_notes text,
    company_name text,
    docs_due_at timestamp without time zone,
    docs_reminder_last_sent_at timestamp without time zone,
    docs_reminder_count integer DEFAULT 0 NOT NULL,
    docs_reminder_escalated boolean DEFAULT false NOT NULL,
    staff_declined_at timestamp with time zone,
    staff_declined_by uuid,
    staff_decline_reason text,
    q_business_province text,
    q_ca_loan_type text,
    q_ca_id_type text,
    q_ca_id_number text,
    has_co_guarantors boolean DEFAULT false NOT NULL,
    declarations jsonb,
    loan_agreement_uploaded_at timestamp with time zone,
    CONSTRAINT bi_applications_facility_type_check CHECK (((facility_type IS NULL) OR (facility_type = ANY (ARRAY['secured'::text, 'unsecured'::text])))),
    CONSTRAINT bi_applications_pgi_limit_max_chk CHECK (((pgi_limit IS NULL) OR (pgi_limit <= (1000000)::numeric))),
    CONSTRAINT bi_applications_q_business_province_chk CHECK (((q_business_province IS NULL) OR (q_business_province <> 'QC'::text))),
    CONSTRAINT bi_applications_q_ca_loan_type_chk CHECK (((q_ca_loan_type IS NULL) OR (q_ca_loan_type = ANY (ARRAY['Commercial Mortgage'::text, 'Other Secured Loan'::text])))),
    CONSTRAINT bi_applications_score_decision_check CHECK (((score_decision IS NULL) OR (score_decision = ANY (ARRAY['approve'::text, 'decline'::text, 'pending'::text, 'error'::text])))),
    CONSTRAINT bi_applications_status_check CHECK ((status = ANY (ARRAY['new_application'::text, 'created'::text, 'in_progress'::text, 'document_review'::text, 'ready_for_submission'::text, 'submitted'::text, 'sent_to_pgi'::text, 'docs_rejected'::text, 'under_review'::text, 'information_required'::text, 'approved'::text, 'accepted'::text, 'declined'::text, 'policy_issued'::text])))
);


--
-- Name: bi_carrier_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_carrier_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coverage_code text NOT NULL,
    country text NOT NULL,
    carrier text NOT NULL,
    product_name text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    instant_bind boolean DEFAULT false NOT NULL,
    submission_email text,
    submission_url text,
    verified boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_carrier_products_country_check CHECK ((country = ANY (ARRAY['CA'::text, 'US'::text])))
);


--
-- Name: bi_carrier_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_carrier_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    application_product_id uuid NOT NULL,
    carrier_product_id uuid NOT NULL,
    carrier text NOT NULL,
    method text NOT NULL,
    sent_to text,
    note text,
    sent_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_carrier_submissions_method_check CHECK ((method = ANY (ARRAY['email'::text, 'portal'::text])))
);


--
-- Name: bi_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    policy_number text,
    status text DEFAULT 'opened'::text NOT NULL,
    amount_claimed numeric(14,2),
    amount_paid numeric(14,2),
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_client_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_client_push_tokens (
    token text NOT NULL,
    applicant_phone text,
    platform text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_client_push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))
);


--
-- Name: bi_co_guarantors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_co_guarantors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    date_of_birth date NOT NULL,
    phone text NOT NULL,
    address text NOT NULL,
    city text NOT NULL,
    province text NOT NULL,
    postal_code text NOT NULL,
    relationship text DEFAULT 'Guarantor'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_co_guarantors_province_chk CHECK ((province <> 'QC'::text))
);


--
-- Name: bi_commission_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_commission_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    policy_year integer,
    insured_amount numeric,
    annual_premium numeric,
    commission numeric,
    renewal_date date,
    paid boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_commission_payables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_commission_payables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    recipient_id uuid,
    recipient_type text,
    amount numeric(14,2) NOT NULL,
    status text DEFAULT 'accruing'::text NOT NULL,
    batch_id uuid,
    earned_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_commissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    annual_premium_amount numeric(14,2),
    commission_rate numeric(6,4) DEFAULT 0.05 NOT NULL,
    commission_amount numeric(14,2),
    status public.bi_commission_status DEFAULT 'estimated'::public.bi_commission_status NOT NULL,
    premium_received_at timestamp without time zone,
    paid_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_name text NOT NULL,
    operating_name text,
    business_number text,
    address_line1 text,
    city text,
    province text,
    postal_code text,
    industry text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'applicant'::text NOT NULL,
    email text,
    phone text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    website text,
    owner_id uuid
);


--
-- Name: bi_consent_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_consent_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_e164 text NOT NULL,
    ip inet,
    user_agent text,
    consent_checked boolean NOT NULL,
    terms_version text NOT NULL,
    privacy_version text NOT NULL,
    consent_version text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_contact_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_contact_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    actor_id text,
    actor_name text,
    event_type text NOT NULL,
    outcome text,
    body text,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_contact_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_contact_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text,
    full_name text NOT NULL,
    email text NOT NULL,
    phone_e164 text,
    message text,
    tags text[] DEFAULT ARRAY['contact_lead'::text] NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    full_name text NOT NULL,
    email text,
    phone_e164 text,
    tags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    apollo_contact_id text,
    apollo_last_synced_at timestamp without time zone,
    apollo_data jsonb,
    apollo_stage text,
    apollo_sequence_names text[] DEFAULT ARRAY[]::text[] NOT NULL,
    icp_segment text,
    email_status text DEFAULT 'unknown'::text NOT NULL,
    lifecycle_stage text DEFAULT 'lead'::text NOT NULL,
    source_first text,
    outreach_status text,
    outreach_owner_id text,
    title text,
    notes text,
    outreach_updated_at timestamp with time zone,
    apollo_label_ids text[] DEFAULT ARRAY[]::text[],
    first_name text,
    last_name text,
    converted_to_company_id uuid,
    outreach_stage text DEFAULT 'new'::text,
    owner_user_id uuid,
    industry text,
    promoted_lender_id uuid,
    last_enriched_at timestamp with time zone,
    manually_edited_fields jsonb DEFAULT '[]'::jsonb,
    organization_name text,
    organization_industry text,
    linkedin_url text,
    phone_numbers jsonb DEFAULT '[]'::jsonb,
    city text,
    state text,
    country text,
    outreach_segment text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    outreach_excluded boolean DEFAULT false NOT NULL,
    otp_nudge_sent_at timestamp without time zone,
    otp_nudge2_sent_at timestamp without time zone,
    marketing_consent_basis text,
    marketing_consent_at timestamp with time zone,
    marketing_consent_source text,
    marketing_consent_expires_at timestamp with time zone,
    CONSTRAINT bi_contacts_outreach_segment_check CHECK (((outreach_segment IS NULL) OR (outreach_segment = ANY (ARRAY['lender'::text, 'broker'::text])))),
    CONSTRAINT bi_contacts_outreach_status_check CHECK (((outreach_status IS NULL) OR (outreach_status = ANY (ARRAY['new'::text, 'contacted'::text, 'engaged'::text, 'demo_booked'::text, 'demo_completed'::text, 'onboarding'::text, 'active'::text, 'not_interested'::text, 'cold'::text, 'attempting'::text, 'voicemail'::text, 'lender'::text]))))
);


--
-- Name: bi_contract_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_contract_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    document_id uuid,
    coverage_code text NOT NULL,
    extracted_limit numeric(14,2),
    limit_basis text,
    clause_text text DEFAULT ''::text NOT NULL,
    confidence numeric(3,2) DEFAULT 0 NOT NULL,
    confirmed_by_client boolean,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_coverage_gaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_coverage_gaps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    coverage_code text NOT NULL,
    country text NOT NULL,
    requested_limit numeric(14,2),
    limit_basis text,
    clause_text text,
    source text DEFAULT 'contract'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    staff_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_coverage_gaps_country_check CHECK ((country = ANY (ARRAY['CA'::text, 'US'::text]))),
    CONSTRAINT bi_coverage_gaps_source_check CHECK ((source = ANY (ARRAY['contract'::text, 'client_request'::text]))),
    CONSTRAINT bi_coverage_gaps_status_check CHECK ((status = ANY (ARRAY['open'::text, 'referred'::text, 'placed'::text, 'declined'::text, 'closed'::text])))
);


--
-- Name: bi_coverage_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_coverage_labels (
    coverage_code text NOT NULL,
    display_name text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_coverage_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_coverage_questions (
    coverage_code text NOT NULL,
    question_key text NOT NULL,
    country text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    CONSTRAINT bi_coverage_questions_country_check CHECK ((country = ANY (ARRAY['CA'::text, 'US'::text])))
);


--
-- Name: bi_crm_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_crm_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    activity_type character varying(100) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_crm_engagement_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_crm_engagement_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid,
    apollo_contact_id text,
    event_type text NOT NULL,
    source text DEFAULT 'apollo'::text NOT NULL,
    apollo_message_id text,
    sequence_name text,
    occurred_at timestamp without time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    apollo_sequence_id text
);


--
-- Name: bi_crm_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_crm_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    event_type character varying(100) NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    doc_type public.bi_document_type NOT NULL,
    original_filename text,
    storage_key text,
    mime_type text,
    bytes bigint,
    uploaded_by_actor public.bi_actor_type NOT NULL,
    uploaded_by_user_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    purged_at timestamp without time zone,
    review_status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp without time zone,
    rejection_reason text,
    blob_name text,
    blob_url text,
    sha256_hash text,
    period_end date,
    doc_slot text,
    extracted_text text,
    ocr_status public.bi_ocr_status DEFAULT 'pending'::public.bi_ocr_status NOT NULL,
    ocr_error text,
    ocr_completed_at timestamp without time zone,
    document_type text,
    document_type_legacy text,
    bf_document_id text,
    bf_application_id text,
    source text,
    pgi_document_id text,
    forwarded_to_carrier_at timestamp without time zone,
    detected_type text,
    detected_confidence numeric(4,2),
    detected_mismatch boolean,
    CONSTRAINT bi_documents_type_check CHECK (((document_type IS NULL) OR (document_type = ANY (ARRAY['profit_loss'::text, 'balance_sheet'::text, 'ar_aging'::text, 'ap_aging'::text, 'founder_cv'::text, 'financial_forecast'::text]))))
);


--
-- Name: bi_email_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_email_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text NOT NULL,
    content_type text NOT NULL,
    content bytea NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_email_link_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_email_link_clicks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text,
    contact_id text,
    email text NOT NULL,
    url text NOT NULL,
    clicked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_email_relay; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_email_relay (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    direction text NOT NULL,
    from_email text,
    to_email text,
    subject text,
    body_preview text,
    provider_message_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_email_relay_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))
);


--
-- Name: bi_email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    subject text,
    body_text text,
    body_html text,
    category text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    fields jsonb
);


--
-- Name: bi_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    silo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_idempotency (
    id text NOT NULL,
    scope text,
    payload_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: bi_industries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_industries (
    code text NOT NULL,
    display_name text NOT NULL,
    naics_code text NOT NULL,
    wants_contract boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_industry_coverages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_industry_coverages (
    industry_code text NOT NULL,
    coverage_code text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL
);


--
-- Name: bi_industry_routing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_industry_routing_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    industry text NOT NULL,
    owner_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    scheduled_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    status text DEFAULT 'quote_started'::text,
    channel text DEFAULT 'direct'::text,
    referrer_id uuid,
    lender_origin boolean DEFAULT false,
    email text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    entry_type text NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CAD'::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_lender_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_lender_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lender_id uuid NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    label text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    revoked_at timestamp without time zone,
    last_used_at timestamp without time zone
);


--
-- Name: bi_lender_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_lender_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lender_id uuid NOT NULL,
    full_name text NOT NULL,
    email text,
    phone_e164 text,
    role text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_lender_login_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_lender_login_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lender_id uuid NOT NULL,
    email text,
    phone_e164 text,
    full_name text,
    role text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_lender_login_contacts_check CHECK (((email IS NOT NULL) OR (phone_e164 IS NOT NULL)))
);


--
-- Name: bi_lenders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_lenders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    company_name text,
    rep_full_name text,
    rep_email text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    website_url text,
    address_line1 text,
    city text,
    province text,
    postal_code text,
    country text DEFAULT 'CA'::text NOT NULL,
    contact_full_name text,
    contact_email text,
    contact_phone_e164 text,
    is_active boolean DEFAULT true NOT NULL,
    created_by_user_id uuid,
    is_demo boolean DEFAULT false NOT NULL,
    live_keys_enabled boolean DEFAULT false NOT NULL
);


--
-- Name: bi_mailbox_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_mailbox_health (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mailbox text NOT NULL,
    channel text NOT NULL,
    window_start date NOT NULL,
    sent integer DEFAULT 0 NOT NULL,
    delivered integer DEFAULT 0 NOT NULL,
    opened integer DEFAULT 0 NOT NULL,
    clicked integer DEFAULT 0 NOT NULL,
    replied integer DEFAULT 0 NOT NULL,
    bounced integer DEFAULT 0 NOT NULL,
    spam_complained integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_mailbox_health_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text])))
);


--
-- Name: bi_marketing_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_marketing_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid,
    apollo_contact_id text,
    apollo_message_id text,
    apollo_sequence_id text,
    sequence_name text,
    replied_at timestamp without time zone NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    assigned_to_user_id uuid,
    notes text,
    closed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_marketing_send_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_marketing_send_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text,
    contact_id text,
    email text NOT NULL,
    event_type text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_marketing_send_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_marketing_send_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid,
    subject text NOT NULL,
    html text NOT NULL,
    text_body text,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error text,
    total integer DEFAULT 0 NOT NULL,
    CONSTRAINT bi_marketing_send_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'cancelled'::text, 'failed'::text])))
);


--
-- Name: bi_marketing_send_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_marketing_send_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    accepted_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_marketing_send_recipients_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: bi_maya_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_maya_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    audience text NOT NULL,
    service_source text,
    tool text NOT NULL,
    args_redacted jsonb,
    result_summary text,
    ok boolean DEFAULT true NOT NULL,
    error_code text,
    CONSTRAINT bi_maya_audit_audience_check CHECK ((audience = ANY (ARRAY['visitor'::text, 'client'::text, 'staff'::text])))
);


--
-- Name: bi_migrations_applied; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_migrations_applied (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    body text NOT NULL,
    owner_user_id uuid,
    mentions text[] DEFAULT '{}'::text[] NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_otp_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_otp_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_e164 text NOT NULL,
    purpose text NOT NULL,
    otp_provider text DEFAULT 'twilio'::text NOT NULL,
    provider_sid text,
    verified boolean DEFAULT false NOT NULL,
    requested_ip inet,
    user_agent text,
    requested_at timestamp without time zone DEFAULT now() NOT NULL,
    verified_at timestamp without time zone,
    name text,
    email text,
    user_type text DEFAULT 'applicant'::text,
    CONSTRAINT bi_otp_sessions_purpose_check CHECK ((purpose = ANY (ARRAY['login'::text, 'resume_application'::text])))
);


--
-- Name: bi_outreach_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_outreach_stages (
    id text NOT NULL,
    label text NOT NULL,
    ordinal integer NOT NULL,
    is_terminal boolean DEFAULT false NOT NULL,
    hidden_by_default boolean DEFAULT false NOT NULL,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_payout_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_payout_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_number text,
    status text DEFAULT 'open'::text NOT NULL,
    total_amount numeric(14,2) DEFAULT 0 NOT NULL,
    cutoff_at timestamp with time zone,
    paid_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    policy_id text,
    status text DEFAULT 'active'::text NOT NULL,
    effective_date date,
    expiry_date date,
    premium_amount numeric,
    data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_policies_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'lapsed'::text, 'expired'::text, 'claim_open'::text, 'claim_closed'::text])))
);


--
-- Name: bi_premium_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_premium_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    due_date date NOT NULL,
    amount numeric(14,2) NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    paid_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    display_name text NOT NULL,
    carrier text NOT NULL,
    country text NOT NULL,
    coverage_category text NOT NULL,
    industry text DEFAULT 'construction'::text NOT NULL,
    tier integer,
    instant_bind boolean DEFAULT false NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_products_country_check CHECK ((country = ANY (ARRAY['CA'::text, 'US'::text])))
);


--
-- Name: bi_purge_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_purge_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    eligible_at timestamp without time zone NOT NULL,
    purged_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_questions (
    question_key text NOT NULL,
    prompt text NOT NULL,
    help_text text,
    input_type text DEFAULT 'yes_no'::text NOT NULL,
    group_key text DEFAULT 'general'::text NOT NULL,
    adverse_answer text,
    required boolean DEFAULT true NOT NULL,
    depends_on_key text,
    depends_on_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    options jsonb,
    min_value numeric(14,2),
    max_value numeric(14,2),
    placeholder text,
    CONSTRAINT bi_questions_input_type_check CHECK ((input_type = ANY (ARRAY['yes_no'::text, 'agree_disagree'::text, 'text'::text, 'textarea'::text, 'number'::text, 'date'::text, 'select'::text])))
);


--
-- Name: bi_referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid NOT NULL,
    company_name text NOT NULL,
    full_name text NOT NULL,
    email text,
    phone_e164 text,
    tags text[] DEFAULT ARRAY['referral'::text] NOT NULL,
    application_created boolean DEFAULT false NOT NULL,
    application_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    ref_code text,
    sms_sent_at timestamp without time zone,
    matched_at timestamp without time zone,
    status text,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    short_code text,
    CONSTRAINT bi_referrals_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'applied'::text, 'approved'::text, 'bound'::text, 'declined'::text, 'cancelled'::text])))
);


--
-- Name: bi_referrer_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_referrer_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid NOT NULL,
    template_id text NOT NULL,
    request_id text,
    signnow_document_id text,
    signing_link text,
    status public.bi_referrer_agreement_status DEFAULT 'not_sent'::public.bi_referrer_agreement_status NOT NULL,
    sent_at timestamp without time zone,
    signed_at timestamp without time zone,
    expired_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_referrer_commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_referrer_commissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid NOT NULL,
    referral_id uuid,
    application_id uuid,
    bi_commission_id uuid,
    amount numeric(14,2),
    status text DEFAULT 'accrued'::text NOT NULL,
    accrued_at timestamp without time zone DEFAULT now() NOT NULL,
    payable_at timestamp without time zone,
    paid_at timestamp without time zone,
    notes text
);


--
-- Name: bi_referrers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_referrers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    company_name text,
    full_name text,
    email text,
    phone_e164 text NOT NULL,
    agreement_status public.bi_referrer_agreement_status DEFAULT 'not_sent'::public.bi_referrer_agreement_status NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    etransfer_email text,
    address_line1 text,
    city text,
    province text,
    postal_code text,
    country text DEFAULT 'CA'::text,
    profile_completed_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    first_name text,
    last_name text,
    address_line2 text,
    intake_complete boolean DEFAULT false NOT NULL
);


--
-- Name: bi_required_doc_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_required_doc_catalog (
    doc_type public.bi_document_type NOT NULL,
    display_label text NOT NULL,
    description text,
    if_startup boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    required boolean DEFAULT true NOT NULL
);


--
-- Name: bi_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    label text NOT NULL,
    status public.bi_requirement_status DEFAULT 'pending'::public.bi_requirement_status NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_requirements_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_requirements_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requirement_id uuid NOT NULL,
    application_id uuid NOT NULL,
    old_status public.bi_requirement_status,
    new_status public.bi_requirement_status NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_sequence_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sequence_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_step integer DEFAULT 0 NOT NULL,
    variant text DEFAULT 'A'::text NOT NULL,
    paused_reason text,
    next_step_at timestamp without time zone,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    last_step_at timestamp without time zone,
    completed_at timestamp without time zone,
    next_send_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bi_sequence_enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'stopped'::text])))
);


--
-- Name: bi_sequence_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sequence_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    step_id uuid,
    event_type text NOT NULL,
    channel text,
    sender_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_sequence_events_event_type_check CHECK ((event_type = ANY (ARRAY['sent'::text, 'delivered'::text, 'opened'::text, 'clicked'::text, 'replied'::text, 'bounced'::text, 'stopped'::text, 'failed'::text, 'suppressed'::text, 'skipped'::text])))
);


--
-- Name: bi_sequence_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sequence_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    filter_spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


--
-- Name: bi_sequence_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sequence_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    step_number integer NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    m365_message_id text,
    m365_thread_id text,
    from_user_id uuid NOT NULL,
    to_email text NOT NULL,
    subject text,
    status text DEFAULT 'sent'::text NOT NULL,
    error_message text,
    attempts integer DEFAULT 0 NOT NULL,
    CONSTRAINT bi_sequence_sends_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'bounced'::text, 'replied'::text])))
);


--
-- Name: bi_sequence_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sequence_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_id uuid NOT NULL,
    "position" integer NOT NULL,
    type text NOT NULL,
    delay_seconds integer DEFAULT 0 NOT NULL,
    subject text,
    body text,
    variant text DEFAULT 'A'::text NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    assignee_user_id uuid,
    CONSTRAINT bi_sequence_steps_type_check CHECK ((type = ANY (ARRAY['sms'::text, 'email'::text, 'task'::text, 'wait'::text])))
);


--
-- Name: bi_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    send_rate_cap integer DEFAULT 100 NOT NULL,
    send_hours_local_start integer DEFAULT 9 NOT NULL,
    send_hours_local_end integer DEFAULT 17 NOT NULL,
    send_weekdays_only boolean DEFAULT true NOT NULL,
    ab_enabled boolean DEFAULT false NOT NULL,
    sender_rotation text[] DEFAULT ARRAY[]::text[] NOT NULL,
    pause_on_reply boolean DEFAULT true NOT NULL,
    pause_on_bounce boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    CONSTRAINT bi_sequences_send_hours_local_end_check CHECK (((send_hours_local_end >= 1) AND (send_hours_local_end <= 24))),
    CONSTRAINT bi_sequences_send_hours_local_start_check CHECK (((send_hours_local_start >= 0) AND (send_hours_local_start <= 23))),
    CONSTRAINT bi_sequences_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'archived'::text])))
);


--
-- Name: bi_sms_opt_outs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sms_opt_outs (
    phone_e164 text NOT NULL,
    opted_out_at timestamp with time zone DEFAULT now() NOT NULL,
    source text,
    raw_body text
);


--
-- Name: bi_staff_notify_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_staff_notify_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    full_name text NOT NULL,
    phone_e164 text NOT NULL,
    notify_contact_form boolean DEFAULT true NOT NULL,
    notify_new_application boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_staff_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_staff_profile (
    staff_user_id text NOT NULL,
    display_name text,
    bookings_url text,
    phone_e164 text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    full_name text,
    email text,
    role text,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: bi_submission_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_submission_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    payload_snapshot jsonb NOT NULL,
    submitted_by uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    response_status integer,
    response_body jsonb,
    error_message text
);


--
-- Name: bi_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_suppressions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid,
    phone_e164 text,
    email text,
    channel text DEFAULT 'all'::text NOT NULL,
    reason text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    identifier text,
    legal_name text,
    display_name text
);


--
-- Name: bi_user_send_quotas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_user_send_quotas (
    user_id uuid NOT NULL,
    daily_limit integer DEFAULT 0 NOT NULL,
    sent_today integer DEFAULT 0 NOT NULL,
    window_start_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    quota_date date DEFAULT CURRENT_DATE NOT NULL
);


--
-- Name: bi_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_e164 text NOT NULL,
    user_type public.bi_actor_type NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT bi_users_user_type_check CHECK ((user_type = ANY (ARRAY['applicant'::public.bi_actor_type, 'lender'::public.bi_actor_type, 'referrer'::public.bi_actor_type])))
);


--
-- Name: bi_visitor_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_visitor_events (
    id bigint NOT NULL,
    session_id text NOT NULL,
    event_type text NOT NULL,
    path text,
    title text,
    step text,
    dwell_ms integer,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bi_visitor_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_visitor_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_visitor_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_visitor_events_id_seq OWNED BY public.bi_visitor_events.id;


--
-- Name: bi_visitor_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_visitor_sessions (
    session_id text NOT NULL,
    public_id text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    landing_page text,
    referrer text,
    gclid text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    user_agent text
);


--
-- Name: bi_webhook_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_webhook_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pgi_webhook_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contact_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company text,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: lender_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lender_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lender_id uuid,
    filename text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: lenders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lenders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: maya_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maya_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    email text,
    phone text,
    last_message text,
    created_at timestamp without time zone DEFAULT now(),
    referral_code text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    crm_status text
);


--
-- Name: naics_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naics_codes (
    code text NOT NULL,
    country text NOT NULL,
    title text NOT NULL,
    description text,
    cached_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pgi_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgi_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    data jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: pgmigrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgmigrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    run_on timestamp without time zone NOT NULL
);


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pgmigrations_id_seq OWNED BY public.pgmigrations.id;


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid,
    company text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: referrers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_visitor_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_visitor_events ALTER COLUMN id SET DEFAULT nextval('public.bi_visitor_events_id_seq'::regclass);


--
-- Name: pgmigrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations ALTER COLUMN id SET DEFAULT nextval('public.pgmigrations_id_seq'::regclass);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_login_security admin_login_security_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_login_security
    ADD CONSTRAINT admin_login_security_email_key UNIQUE (email);


--
-- Name: admin_login_security admin_login_security_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_login_security
    ADD CONSTRAINT admin_login_security_pkey PRIMARY KEY (id);


--
-- Name: admin_otp_codes admin_otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_otp_codes
    ADD CONSTRAINT admin_otp_codes_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: bi_activity bi_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_activity
    ADD CONSTRAINT bi_activity_pkey PRIMARY KEY (id);


--
-- Name: bi_apollo_email_accounts bi_apollo_email_accounts_apollo_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_email_accounts
    ADD CONSTRAINT bi_apollo_email_accounts_apollo_account_id_key UNIQUE (apollo_account_id);


--
-- Name: bi_apollo_email_accounts bi_apollo_email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_email_accounts
    ADD CONSTRAINT bi_apollo_email_accounts_pkey PRIMARY KEY (id);


--
-- Name: bi_apollo_enrichment bi_apollo_enrichment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_enrichment
    ADD CONSTRAINT bi_apollo_enrichment_pkey PRIMARY KEY (contact_id);


--
-- Name: bi_apollo_enrollment bi_apollo_enrollment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_enrollment
    ADD CONSTRAINT bi_apollo_enrollment_pkey PRIMARY KEY (id);


--
-- Name: bi_apollo_sequence bi_apollo_sequence_apollo_sequence_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_sequence
    ADD CONSTRAINT bi_apollo_sequence_apollo_sequence_id_key UNIQUE (apollo_sequence_id);


--
-- Name: bi_apollo_sequence bi_apollo_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_sequence
    ADD CONSTRAINT bi_apollo_sequence_pkey PRIMARY KEY (id);


--
-- Name: bi_apollo_sequences bi_apollo_sequences_apollo_sequence_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_sequences
    ADD CONSTRAINT bi_apollo_sequences_apollo_sequence_id_key UNIQUE (apollo_sequence_id);


--
-- Name: bi_apollo_sequences bi_apollo_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_sequences
    ADD CONSTRAINT bi_apollo_sequences_pkey PRIMARY KEY (id);


--
-- Name: bi_apollo_sync_state bi_apollo_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_sync_state
    ADD CONSTRAINT bi_apollo_sync_state_pkey PRIMARY KEY (id);


--
-- Name: bi_applicant_device_credentials bi_applicant_device_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applicant_device_credentials
    ADD CONSTRAINT bi_applicant_device_credentials_pkey PRIMARY KEY (id);


--
-- Name: bi_application_answers bi_application_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_application_answers
    ADD CONSTRAINT bi_application_answers_pkey PRIMARY KEY (application_id, question_key);


--
-- Name: bi_application_products bi_application_products_application_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_application_products
    ADD CONSTRAINT bi_application_products_application_id_product_id_key UNIQUE (application_id, product_id);


--
-- Name: bi_application_products bi_application_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_application_products
    ADD CONSTRAINT bi_application_products_pkey PRIMARY KEY (id);


--
-- Name: bi_applications bi_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT bi_applications_pkey PRIMARY KEY (id);


--
-- Name: bi_carrier_products bi_carrier_products_coverage_code_country_carrier_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_carrier_products
    ADD CONSTRAINT bi_carrier_products_coverage_code_country_carrier_key UNIQUE (coverage_code, country, carrier);


--
-- Name: bi_carrier_products bi_carrier_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_carrier_products
    ADD CONSTRAINT bi_carrier_products_pkey PRIMARY KEY (id);


--
-- Name: bi_carrier_submissions bi_carrier_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_carrier_submissions
    ADD CONSTRAINT bi_carrier_submissions_pkey PRIMARY KEY (id);


--
-- Name: bi_claims bi_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_claims
    ADD CONSTRAINT bi_claims_pkey PRIMARY KEY (id);


--
-- Name: bi_client_push_tokens bi_client_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_client_push_tokens
    ADD CONSTRAINT bi_client_push_tokens_pkey PRIMARY KEY (token);


--
-- Name: bi_co_guarantors bi_co_guarantors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_co_guarantors
    ADD CONSTRAINT bi_co_guarantors_pkey PRIMARY KEY (id);


--
-- Name: bi_commission_ledger bi_commission_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_commission_ledger
    ADD CONSTRAINT bi_commission_ledger_pkey PRIMARY KEY (id);


--
-- Name: bi_commission_payables bi_commission_payables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_commission_payables
    ADD CONSTRAINT bi_commission_payables_pkey PRIMARY KEY (id);


--
-- Name: bi_commissions bi_commissions_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_commissions
    ADD CONSTRAINT bi_commissions_application_id_key UNIQUE (application_id);


--
-- Name: bi_commissions bi_commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_commissions
    ADD CONSTRAINT bi_commissions_pkey PRIMARY KEY (id);


--
-- Name: bi_companies bi_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_companies
    ADD CONSTRAINT bi_companies_pkey PRIMARY KEY (id);


--
-- Name: bi_consent_logs bi_consent_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_consent_logs
    ADD CONSTRAINT bi_consent_logs_pkey PRIMARY KEY (id);


--
-- Name: bi_contact_activity bi_contact_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_contact_activity
    ADD CONSTRAINT bi_contact_activity_pkey PRIMARY KEY (id);


--
-- Name: bi_contact_leads bi_contact_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_contact_leads
    ADD CONSTRAINT bi_contact_leads_pkey PRIMARY KEY (id);


--
-- Name: bi_contacts bi_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_contacts
    ADD CONSTRAINT bi_contacts_pkey PRIMARY KEY (id);


--
-- Name: bi_contract_requirements bi_contract_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_contract_requirements
    ADD CONSTRAINT bi_contract_requirements_pkey PRIMARY KEY (id);


--
-- Name: bi_coverage_gaps bi_coverage_gaps_application_id_coverage_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_coverage_gaps
    ADD CONSTRAINT bi_coverage_gaps_application_id_coverage_code_key UNIQUE (application_id, coverage_code);


--
-- Name: bi_coverage_gaps bi_coverage_gaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_coverage_gaps
    ADD CONSTRAINT bi_coverage_gaps_pkey PRIMARY KEY (id);


--
-- Name: bi_coverage_labels bi_coverage_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_coverage_labels
    ADD CONSTRAINT bi_coverage_labels_pkey PRIMARY KEY (coverage_code);


--
-- Name: bi_coverage_questions bi_coverage_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_coverage_questions
    ADD CONSTRAINT bi_coverage_questions_pkey PRIMARY KEY (coverage_code, question_key, country);


--
-- Name: bi_crm_activities bi_crm_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_crm_activities
    ADD CONSTRAINT bi_crm_activities_pkey PRIMARY KEY (id);


--
-- Name: bi_crm_engagement_events bi_crm_engagement_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_crm_engagement_events
    ADD CONSTRAINT bi_crm_engagement_events_pkey PRIMARY KEY (id);


--
-- Name: bi_crm_events bi_crm_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_crm_events
    ADD CONSTRAINT bi_crm_events_pkey PRIMARY KEY (id);


--
-- Name: bi_documents bi_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_documents
    ADD CONSTRAINT bi_documents_pkey PRIMARY KEY (id);


--
-- Name: bi_email_assets bi_email_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_email_assets
    ADD CONSTRAINT bi_email_assets_pkey PRIMARY KEY (id);


--
-- Name: bi_email_link_clicks bi_email_link_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_email_link_clicks
    ADD CONSTRAINT bi_email_link_clicks_pkey PRIMARY KEY (id);


--
-- Name: bi_email_relay bi_email_relay_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_email_relay
    ADD CONSTRAINT bi_email_relay_pkey PRIMARY KEY (id);


--
-- Name: bi_email_templates bi_email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_email_templates
    ADD CONSTRAINT bi_email_templates_pkey PRIMARY KEY (id);


--
-- Name: bi_events bi_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_events
    ADD CONSTRAINT bi_events_pkey PRIMARY KEY (id);


--
-- Name: bi_idempotency bi_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_idempotency
    ADD CONSTRAINT bi_idempotency_pkey PRIMARY KEY (id);


--
-- Name: bi_industries bi_industries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_industries
    ADD CONSTRAINT bi_industries_pkey PRIMARY KEY (code);


--
-- Name: bi_industry_coverages bi_industry_coverages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_industry_coverages
    ADD CONSTRAINT bi_industry_coverages_pkey PRIMARY KEY (industry_code, coverage_code);


--
-- Name: bi_industry_routing_rules bi_industry_routing_rules_industry_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_industry_routing_rules
    ADD CONSTRAINT bi_industry_routing_rules_industry_key UNIQUE (industry);


--
-- Name: bi_industry_routing_rules bi_industry_routing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_industry_routing_rules
    ADD CONSTRAINT bi_industry_routing_rules_pkey PRIMARY KEY (id);


--
-- Name: bi_jobs bi_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_jobs
    ADD CONSTRAINT bi_jobs_pkey PRIMARY KEY (id);


--
-- Name: bi_leads bi_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_leads
    ADD CONSTRAINT bi_leads_pkey PRIMARY KEY (id);


--
-- Name: bi_ledger bi_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_ledger
    ADD CONSTRAINT bi_ledger_pkey PRIMARY KEY (id);


--
-- Name: bi_lender_api_keys bi_lender_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lender_api_keys
    ADD CONSTRAINT bi_lender_api_keys_pkey PRIMARY KEY (id);


--
-- Name: bi_lender_contacts bi_lender_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lender_contacts
    ADD CONSTRAINT bi_lender_contacts_pkey PRIMARY KEY (id);


--
-- Name: bi_lender_login_contacts bi_lender_login_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lender_login_contacts
    ADD CONSTRAINT bi_lender_login_contacts_pkey PRIMARY KEY (id);


--
-- Name: bi_lenders bi_lenders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lenders
    ADD CONSTRAINT bi_lenders_pkey PRIMARY KEY (id);


--
-- Name: bi_lenders bi_lenders_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lenders
    ADD CONSTRAINT bi_lenders_user_id_key UNIQUE (user_id);


--
-- Name: bi_mailbox_health bi_mailbox_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_mailbox_health
    ADD CONSTRAINT bi_mailbox_health_pkey PRIMARY KEY (id);


--
-- Name: bi_marketing_replies bi_marketing_replies_apollo_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_replies
    ADD CONSTRAINT bi_marketing_replies_apollo_message_id_key UNIQUE (apollo_message_id);


--
-- Name: bi_marketing_replies bi_marketing_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_replies
    ADD CONSTRAINT bi_marketing_replies_pkey PRIMARY KEY (id);


--
-- Name: bi_marketing_send_events bi_marketing_send_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_send_events
    ADD CONSTRAINT bi_marketing_send_events_pkey PRIMARY KEY (id);


--
-- Name: bi_marketing_send_jobs bi_marketing_send_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_send_jobs
    ADD CONSTRAINT bi_marketing_send_jobs_pkey PRIMARY KEY (id);


--
-- Name: bi_marketing_send_recipients bi_marketing_send_recipients_job_id_contact_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_send_recipients
    ADD CONSTRAINT bi_marketing_send_recipients_job_id_contact_id_key UNIQUE (job_id, contact_id);


--
-- Name: bi_marketing_send_recipients bi_marketing_send_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_send_recipients
    ADD CONSTRAINT bi_marketing_send_recipients_pkey PRIMARY KEY (id);


--
-- Name: bi_maya_audit bi_maya_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_maya_audit
    ADD CONSTRAINT bi_maya_audit_pkey PRIMARY KEY (id);


--
-- Name: bi_migrations_applied bi_migrations_applied_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_migrations_applied
    ADD CONSTRAINT bi_migrations_applied_pkey PRIMARY KEY (filename);


--
-- Name: bi_notes bi_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_notes
    ADD CONSTRAINT bi_notes_pkey PRIMARY KEY (id);


--
-- Name: bi_otp_sessions bi_otp_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_otp_sessions
    ADD CONSTRAINT bi_otp_sessions_pkey PRIMARY KEY (id);


--
-- Name: bi_outreach_stages bi_outreach_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_outreach_stages
    ADD CONSTRAINT bi_outreach_stages_pkey PRIMARY KEY (id);


--
-- Name: bi_payout_batches bi_payout_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_payout_batches
    ADD CONSTRAINT bi_payout_batches_pkey PRIMARY KEY (id);


--
-- Name: bi_policies bi_policies_application_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_policies
    ADD CONSTRAINT bi_policies_application_unique UNIQUE (application_id);


--
-- Name: bi_policies bi_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_policies
    ADD CONSTRAINT bi_policies_pkey PRIMARY KEY (id);


--
-- Name: bi_premium_schedule bi_premium_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_premium_schedule
    ADD CONSTRAINT bi_premium_schedule_pkey PRIMARY KEY (id);


--
-- Name: bi_products bi_products_code_country_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_products
    ADD CONSTRAINT bi_products_code_country_key UNIQUE (code, country);


--
-- Name: bi_products bi_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_products
    ADD CONSTRAINT bi_products_pkey PRIMARY KEY (id);


--
-- Name: bi_purge_queue bi_purge_queue_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_purge_queue
    ADD CONSTRAINT bi_purge_queue_application_id_key UNIQUE (application_id);


--
-- Name: bi_purge_queue bi_purge_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_purge_queue
    ADD CONSTRAINT bi_purge_queue_pkey PRIMARY KEY (id);


--
-- Name: bi_questions bi_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_questions
    ADD CONSTRAINT bi_questions_pkey PRIMARY KEY (question_key);


--
-- Name: bi_referrals bi_referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrals
    ADD CONSTRAINT bi_referrals_pkey PRIMARY KEY (id);


--
-- Name: bi_referrer_agreements bi_referrer_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrer_agreements
    ADD CONSTRAINT bi_referrer_agreements_pkey PRIMARY KEY (id);


--
-- Name: bi_referrer_commissions bi_referrer_commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrer_commissions
    ADD CONSTRAINT bi_referrer_commissions_pkey PRIMARY KEY (id);


--
-- Name: bi_referrers bi_referrers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrers
    ADD CONSTRAINT bi_referrers_pkey PRIMARY KEY (id);


--
-- Name: bi_referrers bi_referrers_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrers
    ADD CONSTRAINT bi_referrers_user_id_key UNIQUE (user_id);


--
-- Name: bi_required_doc_catalog bi_required_doc_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_required_doc_catalog
    ADD CONSTRAINT bi_required_doc_catalog_pkey PRIMARY KEY (doc_type);


--
-- Name: bi_requirements_history bi_requirements_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_requirements_history
    ADD CONSTRAINT bi_requirements_history_pkey PRIMARY KEY (id);


--
-- Name: bi_requirements bi_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_requirements
    ADD CONSTRAINT bi_requirements_pkey PRIMARY KEY (id);


--
-- Name: bi_sequence_enrollments bi_sequence_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_enrollments
    ADD CONSTRAINT bi_sequence_enrollments_pkey PRIMARY KEY (id);


--
-- Name: bi_sequence_events bi_sequence_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_events
    ADD CONSTRAINT bi_sequence_events_pkey PRIMARY KEY (id);


--
-- Name: bi_sequence_lists bi_sequence_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_lists
    ADD CONSTRAINT bi_sequence_lists_pkey PRIMARY KEY (id);


--
-- Name: bi_sequence_sends bi_sequence_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_sends
    ADD CONSTRAINT bi_sequence_sends_pkey PRIMARY KEY (id);


--
-- Name: bi_sequence_steps bi_sequence_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_steps
    ADD CONSTRAINT bi_sequence_steps_pkey PRIMARY KEY (id);


--
-- Name: bi_sequences bi_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequences
    ADD CONSTRAINT bi_sequences_pkey PRIMARY KEY (id);


--
-- Name: bi_sms_opt_outs bi_sms_opt_outs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sms_opt_outs
    ADD CONSTRAINT bi_sms_opt_outs_pkey PRIMARY KEY (phone_e164);


--
-- Name: bi_staff_notify_recipients bi_staff_notify_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_staff_notify_recipients
    ADD CONSTRAINT bi_staff_notify_recipients_pkey PRIMARY KEY (id);


--
-- Name: bi_staff_profile bi_staff_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_staff_profile
    ADD CONSTRAINT bi_staff_profile_pkey PRIMARY KEY (staff_user_id);


--
-- Name: bi_staff_profile bi_staff_profile_staff_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_staff_profile
    ADD CONSTRAINT bi_staff_profile_staff_user_id_key UNIQUE (staff_user_id);


--
-- Name: bi_submission_logs bi_submission_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_submission_logs
    ADD CONSTRAINT bi_submission_logs_pkey PRIMARY KEY (id);


--
-- Name: bi_suppressions bi_suppressions_channel_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.bi_suppressions
    ADD CONSTRAINT bi_suppressions_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text, 'all'::text, 'call'::text, 'company'::text]))) NOT VALID;


--
-- Name: bi_suppressions bi_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_suppressions
    ADD CONSTRAINT bi_suppressions_pkey PRIMARY KEY (id);


--
-- Name: bi_user_send_quotas bi_user_send_quotas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_user_send_quotas
    ADD CONSTRAINT bi_user_send_quotas_pkey PRIMARY KEY (user_id);


--
-- Name: bi_users bi_users_phone_e164_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_users
    ADD CONSTRAINT bi_users_phone_e164_key UNIQUE (phone_e164);


--
-- Name: bi_users bi_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_users
    ADD CONSTRAINT bi_users_pkey PRIMARY KEY (id);


--
-- Name: bi_visitor_events bi_visitor_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_visitor_events
    ADD CONSTRAINT bi_visitor_events_pkey PRIMARY KEY (id);


--
-- Name: bi_visitor_sessions bi_visitor_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_visitor_sessions
    ADD CONSTRAINT bi_visitor_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: bi_webhook_log bi_webhook_log_pgi_webhook_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_webhook_log
    ADD CONSTRAINT bi_webhook_log_pgi_webhook_id_key UNIQUE (pgi_webhook_id);


--
-- Name: bi_webhook_log bi_webhook_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_webhook_log
    ADD CONSTRAINT bi_webhook_log_pkey PRIMARY KEY (id);


--
-- Name: contact_leads contact_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_leads
    ADD CONSTRAINT contact_leads_pkey PRIMARY KEY (id);


--
-- Name: lender_uploads lender_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lender_uploads
    ADD CONSTRAINT lender_uploads_pkey PRIMARY KEY (id);


--
-- Name: lenders lenders_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lenders
    ADD CONSTRAINT lenders_email_key UNIQUE (email);


--
-- Name: lenders lenders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lenders
    ADD CONSTRAINT lenders_pkey PRIMARY KEY (id);


--
-- Name: maya_leads maya_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maya_leads
    ADD CONSTRAINT maya_leads_pkey PRIMARY KEY (id);


--
-- Name: naics_codes naics_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naics_codes
    ADD CONSTRAINT naics_codes_pkey PRIMARY KEY (code, country);


--
-- Name: pgi_applications pgi_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgi_applications
    ADD CONSTRAINT pgi_applications_pkey PRIMARY KEY (id);


--
-- Name: pgmigrations pgmigrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations
    ADD CONSTRAINT pgmigrations_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: referrers referrers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrers
    ADD CONSTRAINT referrers_pkey PRIMARY KEY (id);


--
-- Name: bi_applications_lender_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_applications_lender_id_idx ON public.bi_applications USING btree (lender_id);


--
-- Name: bi_applications_pgi_app_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_applications_pgi_app_id_idx ON public.bi_applications USING btree (pgi_application_id);


--
-- Name: bi_applications_policy_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_applications_policy_id_idx ON public.bi_applications USING btree (policy_id) WHERE (policy_id IS NOT NULL);


--
-- Name: bi_applications_public_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bi_applications_public_id_idx ON public.bi_applications USING btree (public_id);


--
-- Name: bi_applications_referrer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_applications_referrer_id_idx ON public.bi_applications USING btree (referrer_id);


--
-- Name: bi_applications_staff_declined_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_applications_staff_declined_at_idx ON public.bi_applications USING btree (staff_declined_at) WHERE (staff_declined_at IS NOT NULL);


--
-- Name: bi_applications_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_applications_status_idx ON public.bi_applications USING btree (status);


--
-- Name: bi_client_push_tokens_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_client_push_tokens_phone_idx ON public.bi_client_push_tokens USING btree (applicant_phone);


--
-- Name: bi_contacts_apollo_label_ids_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_contacts_apollo_label_ids_gin_idx ON public.bi_contacts USING gin (apollo_label_ids);


--
-- Name: bi_documents_application_bf_document_unique_v1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bi_documents_application_bf_document_unique_v1 ON public.bi_documents USING btree (application_id, bf_document_id) WHERE (bf_document_id IS NOT NULL);


--
-- Name: bi_idempotency_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_idempotency_created_idx ON public.bi_idempotency USING btree (created_at DESC);


--
-- Name: bi_idempotency_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_idempotency_expires_idx ON public.bi_idempotency USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: bi_lender_api_keys_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bi_lender_api_keys_hash_idx ON public.bi_lender_api_keys USING btree (key_hash);


--
-- Name: bi_lender_api_keys_lender_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_lender_api_keys_lender_idx ON public.bi_lender_api_keys USING btree (lender_id);


--
-- Name: bi_policies_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_policies_application_idx ON public.bi_policies USING btree (application_id);


--
-- Name: bi_policies_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_policies_status_idx ON public.bi_policies USING btree (status);


--
-- Name: bi_referrals_referrer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_referrals_referrer_idx ON public.bi_referrals USING btree (referrer_id);


--
-- Name: bi_submission_logs_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_submission_logs_application_idx ON public.bi_submission_logs USING btree (application_id);


--
-- Name: bi_submission_logs_submitted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bi_submission_logs_submitted_at_idx ON public.bi_submission_logs USING btree (submitted_at DESC);


--
-- Name: idx_bi_activity_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_activity_app ON public.bi_activity USING btree (application_id);


--
-- Name: idx_bi_activity_contact_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_activity_contact_id ON public.bi_activity USING btree (contact_id) WHERE (contact_id IS NOT NULL);


--
-- Name: idx_bi_activity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_activity_created ON public.bi_activity USING btree (created_at);


--
-- Name: idx_bi_answers_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_answers_app ON public.bi_application_answers USING btree (application_id);


--
-- Name: idx_bi_apollo_enrichment_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_apollo_enrichment_email ON public.bi_apollo_enrichment USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_bi_apollo_enrichment_fetched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_apollo_enrichment_fetched ON public.bi_apollo_enrichment USING btree (fetched_at DESC);


--
-- Name: idx_bi_apollo_enrollment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_apollo_enrollment_status ON public.bi_apollo_enrollment USING btree (status);


--
-- Name: idx_bi_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_app_created ON public.bi_applications USING btree (created_at);


--
-- Name: idx_bi_app_lender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_app_lender ON public.bi_applications USING btree (created_by_lender_id);


--
-- Name: idx_bi_app_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_app_phone ON public.bi_applications USING btree (applicant_phone_e164);


--
-- Name: idx_bi_app_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_app_referrer ON public.bi_applications USING btree (referrer_id);


--
-- Name: idx_bi_app_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_app_stage ON public.bi_applications USING btree (stage);


--
-- Name: idx_bi_applicant_device_credentials_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applicant_device_credentials_phone ON public.bi_applicant_device_credentials USING btree (phone_e164) WHERE (revoked_at IS NULL);


--
-- Name: idx_bi_application_products_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_application_products_app ON public.bi_application_products USING btree (application_id);


--
-- Name: idx_bi_applications_application_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_application_code ON public.bi_applications USING btree (application_code);


--
-- Name: idx_bi_applications_bf_application_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_bf_application_id ON public.bi_applications USING btree (bf_application_id) WHERE (bf_application_id IS NOT NULL);


--
-- Name: idx_bi_applications_carrier_last_event_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_carrier_last_event_at ON public.bi_applications USING btree (carrier_last_event_at DESC NULLS LAST);


--
-- Name: idx_bi_applications_carrier_received_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_carrier_received_at ON public.bi_applications USING btree (carrier_received_at DESC NULLS LAST);


--
-- Name: idx_bi_applications_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_company_id ON public.bi_applications USING btree (company_id);


--
-- Name: idx_bi_applications_is_demo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_is_demo ON public.bi_applications USING btree (is_demo);


--
-- Name: idx_bi_applications_lender_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_lender_company_id ON public.bi_applications USING btree (lender_company_id);


--
-- Name: idx_bi_applications_lender_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_lender_id ON public.bi_applications USING btree (lender_id);


--
-- Name: idx_bi_applications_locked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_locked ON public.bi_applications USING btree (submission_locked);


--
-- Name: idx_bi_applications_pending_docs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_pending_docs ON public.bi_applications USING btree (status, created_at) WHERE (status = ANY (ARRAY['in_progress'::text, 'document_review'::text]));


--
-- Name: idx_bi_applications_pgi_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_pgi_external_id ON public.bi_applications USING btree (pgi_external_id);


--
-- Name: idx_bi_applications_referral_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_referral_id ON public.bi_applications USING btree (referral_id) WHERE (referral_id IS NOT NULL);


--
-- Name: idx_bi_applications_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_referrer ON public.bi_applications USING btree (referrer_id) WHERE (referrer_id IS NOT NULL);


--
-- Name: idx_bi_applications_referrer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_referrer_id ON public.bi_applications USING btree (referrer_id) WHERE (referrer_id IS NOT NULL);


--
-- Name: idx_bi_applications_signed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_signed_at ON public.bi_applications USING btree (signed_at);


--
-- Name: idx_bi_applications_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_applications_source ON public.bi_applications USING btree (source_type);


--
-- Name: idx_bi_apps_lender_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_apps_lender_user ON public.bi_applications USING btree (created_by_lender_user_id) WHERE (created_by_lender_user_id IS NOT NULL);


--
-- Name: idx_bi_apps_reminder_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_apps_reminder_due ON public.bi_applications USING btree (docs_due_at, docs_reminder_last_sent_at) WHERE (docs_reminder_escalated = false);


--
-- Name: idx_bi_carrier_submissions_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_carrier_submissions_app ON public.bi_carrier_submissions USING btree (application_id, created_at DESC);


--
-- Name: idx_bi_claims_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_claims_app ON public.bi_claims USING btree (application_id);


--
-- Name: idx_bi_co_guarantors_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_co_guarantors_app ON public.bi_co_guarantors USING btree (application_id);


--
-- Name: idx_bi_comm_premium_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_comm_premium_received ON public.bi_commissions USING btree (premium_received_at);


--
-- Name: idx_bi_comm_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_comm_status ON public.bi_commissions USING btree (status);


--
-- Name: idx_bi_commission_ledger_app_year; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bi_commission_ledger_app_year ON public.bi_commission_ledger USING btree (application_id, policy_year);


--
-- Name: idx_bi_commission_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_commission_status ON public.bi_commission_payables USING btree (status, earned_at) WHERE (status = ANY (ARRAY['accruing'::text, 'batched'::text]));


--
-- Name: idx_bi_consent_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_consent_created ON public.bi_consent_logs USING btree (created_at);


--
-- Name: idx_bi_consent_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_consent_phone ON public.bi_consent_logs USING btree (phone_e164);


--
-- Name: idx_bi_contact_activity_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contact_activity_contact ON public.bi_contact_activity USING btree (contact_id, occurred_at DESC);


--
-- Name: idx_bi_contact_activity_contact_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contact_activity_contact_created ON public.bi_contact_activity USING btree (contact_id, created_at DESC);


--
-- Name: idx_bi_contact_activity_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contact_activity_event_type ON public.bi_contact_activity USING btree (event_type);


--
-- Name: idx_bi_contact_leads_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contact_leads_created ON public.bi_contact_leads USING btree (created_at);


--
-- Name: idx_bi_contacts_apollo_synced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_apollo_synced ON public.bi_contacts USING btree (apollo_last_synced_at);


--
-- Name: idx_bi_contacts_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_company ON public.bi_contacts USING btree (company_id);


--
-- Name: idx_bi_contacts_converted_to_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_converted_to_company_id ON public.bi_contacts USING btree (converted_to_company_id) WHERE (converted_to_company_id IS NOT NULL);


--
-- Name: idx_bi_contacts_email_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_email_status ON public.bi_contacts USING btree (email_status);


--
-- Name: idx_bi_contacts_first_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_first_name ON public.bi_contacts USING btree (first_name);


--
-- Name: idx_bi_contacts_icp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_icp ON public.bi_contacts USING btree (icp_segment) WHERE (icp_segment IS NOT NULL);


--
-- Name: idx_bi_contacts_industry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_industry ON public.bi_contacts USING btree (industry);


--
-- Name: idx_bi_contacts_last_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_last_name ON public.bi_contacts USING btree (last_name);


--
-- Name: idx_bi_contacts_lifecycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_lifecycle ON public.bi_contacts USING btree (lifecycle_stage);


--
-- Name: idx_bi_contacts_outreach_excluded; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_outreach_excluded ON public.bi_contacts USING btree (outreach_excluded) WHERE (outreach_excluded = true);


--
-- Name: idx_bi_contacts_outreach_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_outreach_owner ON public.bi_contacts USING btree (outreach_owner_id) WHERE (outreach_owner_id IS NOT NULL);


--
-- Name: idx_bi_contacts_outreach_segment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_outreach_segment ON public.bi_contacts USING btree (outreach_segment) WHERE (outreach_segment IS NOT NULL);


--
-- Name: idx_bi_contacts_outreach_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_outreach_stage ON public.bi_contacts USING btree (outreach_stage);


--
-- Name: idx_bi_contacts_outreach_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_outreach_status ON public.bi_contacts USING btree (outreach_status) WHERE (outreach_status IS NOT NULL);


--
-- Name: idx_bi_contacts_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_owner_user_id ON public.bi_contacts USING btree (owner_user_id);


--
-- Name: idx_bi_contacts_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_phone ON public.bi_contacts USING btree (phone_e164);


--
-- Name: idx_bi_contacts_promoted_lender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contacts_promoted_lender ON public.bi_contacts USING btree (promoted_lender_id) WHERE (promoted_lender_id IS NOT NULL);


--
-- Name: idx_bi_contract_requirements_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_contract_requirements_app ON public.bi_contract_requirements USING btree (application_id);


--
-- Name: idx_bi_covq_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_covq_lookup ON public.bi_coverage_questions USING btree (coverage_code, country, sort_order);


--
-- Name: idx_bi_docs_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_docs_app ON public.bi_documents USING btree (application_id);


--
-- Name: idx_bi_docs_purged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_docs_purged ON public.bi_documents USING btree (purged_at);


--
-- Name: idx_bi_docs_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_docs_review ON public.bi_documents USING btree (review_status);


--
-- Name: idx_bi_docs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_docs_type ON public.bi_documents USING btree (doc_type);


--
-- Name: idx_bi_documents_app_doctype_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bi_documents_app_doctype_unique ON public.bi_documents USING btree (application_id, doc_type) WHERE (purged_at IS NULL);


--
-- Name: idx_bi_documents_bf_application_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_documents_bf_application_id ON public.bi_documents USING btree (bf_application_id) WHERE (bf_application_id IS NOT NULL);


--
-- Name: idx_bi_documents_bf_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_documents_bf_document_id ON public.bi_documents USING btree (bf_document_id) WHERE (bf_document_id IS NOT NULL);


--
-- Name: idx_bi_documents_blob_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_documents_blob_name ON public.bi_documents USING btree (blob_name);


--
-- Name: idx_bi_documents_doc_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_documents_doc_slot ON public.bi_documents USING btree (application_id, doc_slot);


--
-- Name: idx_bi_documents_loan_agreement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_documents_loan_agreement ON public.bi_documents USING btree (application_id) WHERE (doc_type = ANY (ARRAY['loan_agreement'::public.bi_document_type, 'loan_agreement_signed'::public.bi_document_type]));


--
-- Name: idx_bi_documents_ocr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_documents_ocr_status ON public.bi_documents USING btree (ocr_status);


--
-- Name: idx_bi_documents_pgi_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_documents_pgi_pending ON public.bi_documents USING btree (application_id) WHERE ((pgi_document_id IS NULL) AND (purged_at IS NULL));


--
-- Name: idx_bi_elc_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_elc_email ON public.bi_email_link_clicks USING btree (lower(email));


--
-- Name: idx_bi_elc_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_elc_job ON public.bi_email_link_clicks USING btree (job_id, clicked_at DESC);


--
-- Name: idx_bi_elc_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_elc_url ON public.bi_email_link_clicks USING btree (url, clicked_at DESC);


--
-- Name: idx_bi_email_relay_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_email_relay_app ON public.bi_email_relay USING btree (application_id);


--
-- Name: idx_bi_email_relay_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_email_relay_created ON public.bi_email_relay USING btree (created_at);


--
-- Name: idx_bi_email_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_email_templates_active ON public.bi_email_templates USING btree (is_active, name);


--
-- Name: idx_bi_email_templates_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_email_templates_category ON public.bi_email_templates USING btree (category) WHERE (category IS NOT NULL);


--
-- Name: idx_bi_engagement_apollo_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_engagement_apollo_contact ON public.bi_crm_engagement_events USING btree (apollo_contact_id, occurred_at DESC);


--
-- Name: idx_bi_engagement_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_engagement_contact ON public.bi_crm_engagement_events USING btree (contact_id, occurred_at DESC);


--
-- Name: idx_bi_engagement_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_engagement_occurred_at ON public.bi_crm_engagement_events USING btree (occurred_at DESC);


--
-- Name: idx_bi_engagement_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_engagement_sequence ON public.bi_crm_engagement_events USING btree (apollo_sequence_id, occurred_at DESC);


--
-- Name: idx_bi_enrollment_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_enrollment_contact ON public.bi_sequence_enrollments USING btree (contact_id, status);


--
-- Name: idx_bi_enrollment_next; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_enrollment_next ON public.bi_sequence_enrollments USING btree (next_step_at) WHERE (status = 'active'::text);


--
-- Name: idx_bi_events_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_events_app ON public.bi_events USING btree (application_id, created_at DESC);


--
-- Name: idx_bi_events_enrollment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_events_enrollment ON public.bi_sequence_events USING btree (enrollment_id, created_at DESC);


--
-- Name: idx_bi_events_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_events_type_time ON public.bi_sequence_events USING btree (event_type, created_at DESC);


--
-- Name: idx_bi_gaps_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_gaps_app ON public.bi_coverage_gaps USING btree (application_id);


--
-- Name: idx_bi_gaps_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_gaps_open ON public.bi_coverage_gaps USING btree (status, country, coverage_code);


--
-- Name: idx_bi_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_jobs_status ON public.bi_jobs USING btree (status, scheduled_at) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));


--
-- Name: idx_bi_ledger_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_ledger_app ON public.bi_ledger USING btree (application_id, occurred_at DESC);


--
-- Name: idx_bi_lender_api_keys_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_lender_api_keys_prefix ON public.bi_lender_api_keys USING btree (key_prefix) WHERE (is_active = true);


--
-- Name: idx_bi_lender_contacts_lender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_lender_contacts_lender ON public.bi_lender_contacts USING btree (lender_id);


--
-- Name: idx_bi_lender_login_contacts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_lender_login_contacts_email ON public.bi_lender_login_contacts USING btree (lower(email));


--
-- Name: idx_bi_lender_login_contacts_lender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_lender_login_contacts_lender ON public.bi_lender_login_contacts USING btree (lender_id);


--
-- Name: idx_bi_lender_login_contacts_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_lender_login_contacts_phone ON public.bi_lender_login_contacts USING btree (phone_e164);


--
-- Name: idx_bi_lenders_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_lenders_active ON public.bi_lenders USING btree (is_active);


--
-- Name: idx_bi_lenders_is_demo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_lenders_is_demo ON public.bi_lenders USING btree (is_demo);


--
-- Name: idx_bi_marketing_replies_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_marketing_replies_contact ON public.bi_marketing_replies USING btree (contact_id);


--
-- Name: idx_bi_marketing_replies_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_marketing_replies_status ON public.bi_marketing_replies USING btree (status, replied_at DESC);


--
-- Name: idx_bi_marketing_send_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_marketing_send_events_created ON public.bi_marketing_send_events USING btree (created_at DESC);


--
-- Name: idx_bi_marketing_send_events_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_marketing_send_events_email_lower ON public.bi_marketing_send_events USING btree (lower(email));


--
-- Name: idx_bi_marketing_send_events_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_marketing_send_events_job ON public.bi_marketing_send_events USING btree (job_id);


--
-- Name: idx_bi_marketing_send_jobs_drain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_marketing_send_jobs_drain ON public.bi_marketing_send_jobs USING btree (status, scheduled_at);


--
-- Name: idx_bi_marketing_send_recipients_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_marketing_send_recipients_pending ON public.bi_marketing_send_recipients USING btree (job_id, status);


--
-- Name: idx_bi_maya_audit_audience_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_maya_audit_audience_tool ON public.bi_maya_audit USING btree (audience, tool);


--
-- Name: idx_bi_maya_audit_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_maya_audit_ts ON public.bi_maya_audit USING btree (ts DESC);


--
-- Name: idx_bi_notes_application_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_notes_application_id ON public.bi_notes USING btree (application_id) WHERE (is_deleted = false);


--
-- Name: idx_bi_notes_mentions; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_notes_mentions ON public.bi_notes USING gin (mentions);


--
-- Name: idx_bi_otp_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_otp_phone ON public.bi_otp_sessions USING btree (phone_e164);


--
-- Name: idx_bi_otp_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_otp_verified ON public.bi_otp_sessions USING btree (verified);


--
-- Name: idx_bi_premium_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_premium_app ON public.bi_premium_schedule USING btree (application_id, due_date);


--
-- Name: idx_bi_products_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_products_lookup ON public.bi_products USING btree (country, industry, active);


--
-- Name: idx_bi_purge_eligible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_purge_eligible ON public.bi_purge_queue USING btree (eligible_at);


--
-- Name: idx_bi_ref_agreement_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_ref_agreement_referrer ON public.bi_referrer_agreements USING btree (referrer_id);


--
-- Name: idx_bi_ref_agreement_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_ref_agreement_status ON public.bi_referrer_agreements USING btree (status);


--
-- Name: idx_bi_referrals_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_referrals_created ON public.bi_referrals USING btree (created_at);


--
-- Name: idx_bi_referrals_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_referrals_email_lower ON public.bi_referrals USING btree (lower(email)) WHERE (email IS NOT NULL);


--
-- Name: idx_bi_referrals_phone_e164; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_referrals_phone_e164 ON public.bi_referrals USING btree (phone_e164) WHERE (phone_e164 IS NOT NULL);


--
-- Name: idx_bi_referrals_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_referrals_referrer ON public.bi_referrals USING btree (referrer_id);


--
-- Name: idx_bi_referrals_short_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bi_referrals_short_code_unique ON public.bi_referrals USING btree (short_code) WHERE (short_code IS NOT NULL);


--
-- Name: idx_bi_referrer_commissions_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_referrer_commissions_app ON public.bi_referrer_commissions USING btree (application_id);


--
-- Name: idx_bi_referrer_commissions_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_referrer_commissions_referrer ON public.bi_referrer_commissions USING btree (referrer_id);


--
-- Name: idx_bi_referrers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_referrers_active ON public.bi_referrers USING btree (is_active);


--
-- Name: idx_bi_referrers_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_referrers_email ON public.bi_referrers USING btree (email);


--
-- Name: idx_bi_requirements_application_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_requirements_application_id ON public.bi_requirements USING btree (application_id);


--
-- Name: idx_bi_requirements_history_req_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_requirements_history_req_id ON public.bi_requirements_history USING btree (requirement_id);


--
-- Name: idx_bi_seq_enrollments_next; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_seq_enrollments_next ON public.bi_sequence_enrollments USING btree (next_send_at) WHERE (status = 'active'::text);


--
-- Name: idx_bi_seq_sends_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_seq_sends_thread ON public.bi_sequence_sends USING btree (m365_thread_id);


--
-- Name: idx_bi_sequence_steps_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_sequence_steps_seq ON public.bi_sequence_steps USING btree (sequence_id, "position");


--
-- Name: idx_bi_sequences_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_sequences_status ON public.bi_sequences USING btree (status) WHERE (deleted_at IS NULL);


--
-- Name: idx_bi_staff_notify_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_staff_notify_active ON public.bi_staff_notify_recipients USING btree (is_active);


--
-- Name: idx_bi_staff_profile_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_staff_profile_active ON public.bi_staff_profile USING btree (is_active);


--
-- Name: idx_bi_staff_profile_full_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_staff_profile_full_name ON public.bi_staff_profile USING btree (full_name);


--
-- Name: idx_bi_suppressions_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_suppressions_contact ON public.bi_suppressions USING btree (contact_id) WHERE (contact_id IS NOT NULL);


--
-- Name: idx_bi_suppressions_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_suppressions_email ON public.bi_suppressions USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_bi_suppressions_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_suppressions_email_lower ON public.bi_suppressions USING btree (lower(email));


--
-- Name: idx_bi_suppressions_legal_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_suppressions_legal_name_lower ON public.bi_suppressions USING btree (lower(legal_name));


--
-- Name: idx_bi_suppressions_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_suppressions_phone ON public.bi_suppressions USING btree (phone_e164) WHERE (phone_e164 IS NOT NULL);


--
-- Name: idx_bi_user_send_quotas_quota_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_user_send_quotas_quota_date ON public.bi_user_send_quotas USING btree (quota_date);


--
-- Name: idx_bi_user_send_quotas_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_user_send_quotas_window ON public.bi_user_send_quotas USING btree (window_start_at);


--
-- Name: idx_bi_users_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_users_type ON public.bi_users USING btree (user_type);


--
-- Name: idx_bi_visitor_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_visitor_events_session ON public.bi_visitor_events USING btree (session_id, occurred_at);


--
-- Name: idx_bi_visitor_sessions_public_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_visitor_sessions_public_id ON public.bi_visitor_sessions USING btree (public_id);


--
-- Name: idx_bi_webhook_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_webhook_log_created_at ON public.bi_webhook_log USING btree (created_at);


--
-- Name: idx_bi_webhook_log_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_webhook_log_event_type ON public.bi_webhook_log USING btree (event_type);


--
-- Name: naics_codes_title_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX naics_codes_title_trgm_idx ON public.naics_codes USING gin (lower(title) public.gin_trgm_ops);


--
-- Name: uq_bi_apollo_enrollment_contact_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_apollo_enrollment_contact_sequence ON public.bi_apollo_enrollment USING btree (contact_id, sequence_id);


--
-- Name: uq_bi_applications_application_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_applications_application_code ON public.bi_applications USING btree (application_code) WHERE (application_code IS NOT NULL);


--
-- Name: uq_bi_companies_legal_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_companies_legal_name_lower ON public.bi_companies USING btree (lower(TRIM(BOTH FROM legal_name))) WHERE ((legal_name IS NOT NULL) AND (TRIM(BOTH FROM legal_name) <> ''::text));


--
-- Name: uq_bi_contacts_apollo_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_contacts_apollo_id ON public.bi_contacts USING btree (apollo_contact_id) WHERE (apollo_contact_id IS NOT NULL);


--
-- Name: uq_bi_contacts_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_contacts_email_lower ON public.bi_contacts USING btree (lower(TRIM(BOTH FROM email))) WHERE ((email IS NOT NULL) AND (TRIM(BOTH FROM email) <> ''::text));


--
-- Name: uq_bi_crm_engagement_events_msg_evt; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_crm_engagement_events_msg_evt ON public.bi_crm_engagement_events USING btree (apollo_message_id, event_type) WHERE (apollo_message_id IS NOT NULL);


--
-- Name: uq_bi_engagement_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_engagement_dedupe ON public.bi_crm_engagement_events USING btree (apollo_message_id, event_type) WHERE (apollo_message_id IS NOT NULL);


--
-- Name: uq_bi_enrollment_seq_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_enrollment_seq_contact ON public.bi_sequence_enrollments USING btree (sequence_id, contact_id);


--
-- Name: uq_bi_lender_contacts_phone_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_lender_contacts_phone_active ON public.bi_lender_contacts USING btree (phone_e164) WHERE ((is_active = true) AND (phone_e164 IS NOT NULL));


--
-- Name: uq_bi_mailbox_health_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_mailbox_health_day ON public.bi_mailbox_health USING btree (mailbox, channel, window_start);


--
-- Name: uq_bi_referrals_ref_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_referrals_ref_code ON public.bi_referrals USING btree (ref_code) WHERE (ref_code IS NOT NULL);


--
-- Name: uq_bi_referrer_commissions_app_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_referrer_commissions_app_referrer ON public.bi_referrer_commissions USING btree (application_id, referrer_id);


--
-- Name: uq_bi_referrers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_referrers_phone ON public.bi_referrers USING btree (phone_e164);


--
-- Name: uq_bi_sequence_steps_pos_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bi_sequence_steps_pos_variant ON public.bi_sequence_steps USING btree (sequence_id, "position", variant);


--
-- Name: bi_applications bi_sync_stage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bi_sync_stage BEFORE INSERT OR UPDATE OF status ON public.bi_applications FOR EACH ROW EXECUTE FUNCTION public.bi_sync_stage_trigger();


--
-- Name: bi_applications trg_bi_applications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_applications_updated_at BEFORE UPDATE ON public.bi_applications FOR EACH ROW EXECUTE FUNCTION public.bi_set_updated_at();


--
-- Name: bi_commissions trg_bi_commissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_commissions_updated_at BEFORE UPDATE ON public.bi_commissions FOR EACH ROW EXECUTE FUNCTION public.bi_set_updated_at();


--
-- Name: bi_users trg_bi_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_users_updated_at BEFORE UPDATE ON public.bi_users FOR EACH ROW EXECUTE FUNCTION public.bi_set_updated_at();


--
-- Name: bi_activity bi_activity_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_activity
    ADD CONSTRAINT bi_activity_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.bi_users(id) ON DELETE SET NULL;


--
-- Name: bi_activity bi_activity_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_activity
    ADD CONSTRAINT bi_activity_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_apollo_enrichment bi_apollo_enrichment_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_enrichment
    ADD CONSTRAINT bi_apollo_enrichment_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.bi_contacts(id) ON DELETE CASCADE;


--
-- Name: bi_apollo_enrollment bi_apollo_enrollment_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_enrollment
    ADD CONSTRAINT bi_apollo_enrollment_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.bi_contacts(id) ON DELETE CASCADE;


--
-- Name: bi_apollo_enrollment bi_apollo_enrollment_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_apollo_enrollment
    ADD CONSTRAINT bi_apollo_enrollment_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.bi_apollo_sequence(id) ON DELETE CASCADE;


--
-- Name: bi_application_answers bi_application_answers_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_application_answers
    ADD CONSTRAINT bi_application_answers_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_application_answers bi_application_answers_question_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_application_answers
    ADD CONSTRAINT bi_application_answers_question_key_fkey FOREIGN KEY (question_key) REFERENCES public.bi_questions(question_key) ON DELETE CASCADE;


--
-- Name: bi_application_products bi_application_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_application_products
    ADD CONSTRAINT bi_application_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.bi_products(id);


--
-- Name: bi_applications bi_applications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT bi_applications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.bi_companies(id) ON DELETE SET NULL;


--
-- Name: bi_applications bi_applications_created_by_lender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT bi_applications_created_by_lender_id_fkey FOREIGN KEY (created_by_lender_id) REFERENCES public.bi_lenders(id) ON DELETE SET NULL;


--
-- Name: bi_applications bi_applications_created_by_lender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT bi_applications_created_by_lender_user_id_fkey FOREIGN KEY (created_by_lender_user_id) REFERENCES public.bi_lender_login_contacts(id) ON DELETE SET NULL;


--
-- Name: bi_applications bi_applications_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT bi_applications_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.bi_users(id) ON DELETE SET NULL;


--
-- Name: bi_applications bi_applications_primary_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT bi_applications_primary_contact_id_fkey FOREIGN KEY (primary_contact_id) REFERENCES public.bi_contacts(id) ON DELETE SET NULL;


--
-- Name: bi_applications bi_applications_referral_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT bi_applications_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES public.bi_referrals(id) ON DELETE SET NULL;


--
-- Name: bi_applications bi_applications_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT bi_applications_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.bi_referrers(id) ON DELETE SET NULL;


--
-- Name: bi_carrier_submissions bi_carrier_submissions_carrier_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_carrier_submissions
    ADD CONSTRAINT bi_carrier_submissions_carrier_product_id_fkey FOREIGN KEY (carrier_product_id) REFERENCES public.bi_carrier_products(id);


--
-- Name: bi_co_guarantors bi_co_guarantors_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_co_guarantors
    ADD CONSTRAINT bi_co_guarantors_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_commission_ledger bi_commission_ledger_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_commission_ledger
    ADD CONSTRAINT bi_commission_ledger_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE SET NULL;


--
-- Name: bi_commission_payables bi_commission_payables_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_commission_payables
    ADD CONSTRAINT bi_commission_payables_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.bi_payout_batches(id) ON DELETE SET NULL;


--
-- Name: bi_commissions bi_commissions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_commissions
    ADD CONSTRAINT bi_commissions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_contact_activity bi_contact_activity_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_contact_activity
    ADD CONSTRAINT bi_contact_activity_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.bi_contacts(id) ON DELETE CASCADE;


--
-- Name: bi_contacts bi_contacts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_contacts
    ADD CONSTRAINT bi_contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.bi_companies(id) ON DELETE SET NULL;


--
-- Name: bi_contacts bi_contacts_outreach_stage_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_contacts
    ADD CONSTRAINT bi_contacts_outreach_stage_fkey FOREIGN KEY (outreach_stage) REFERENCES public.bi_outreach_stages(id);


--
-- Name: bi_coverage_gaps bi_coverage_gaps_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_coverage_gaps
    ADD CONSTRAINT bi_coverage_gaps_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_coverage_questions bi_coverage_questions_question_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_coverage_questions
    ADD CONSTRAINT bi_coverage_questions_question_key_fkey FOREIGN KEY (question_key) REFERENCES public.bi_questions(question_key) ON DELETE CASCADE;


--
-- Name: bi_crm_engagement_events bi_crm_engagement_events_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_crm_engagement_events
    ADD CONSTRAINT bi_crm_engagement_events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.bi_contacts(id) ON DELETE CASCADE;


--
-- Name: bi_documents bi_documents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_documents
    ADD CONSTRAINT bi_documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_documents bi_documents_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_documents
    ADD CONSTRAINT bi_documents_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.bi_users(id) ON DELETE SET NULL;


--
-- Name: bi_email_relay bi_email_relay_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_email_relay
    ADD CONSTRAINT bi_email_relay_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_industry_coverages bi_industry_coverages_industry_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_industry_coverages
    ADD CONSTRAINT bi_industry_coverages_industry_code_fkey FOREIGN KEY (industry_code) REFERENCES public.bi_industries(code) ON DELETE CASCADE;


--
-- Name: bi_lender_api_keys bi_lender_api_keys_lender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lender_api_keys
    ADD CONSTRAINT bi_lender_api_keys_lender_id_fkey FOREIGN KEY (lender_id) REFERENCES public.bi_lenders(id) ON DELETE CASCADE;


--
-- Name: bi_lender_contacts bi_lender_contacts_lender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lender_contacts
    ADD CONSTRAINT bi_lender_contacts_lender_id_fkey FOREIGN KEY (lender_id) REFERENCES public.bi_lenders(id) ON DELETE CASCADE;


--
-- Name: bi_lender_login_contacts bi_lender_login_contacts_lender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lender_login_contacts
    ADD CONSTRAINT bi_lender_login_contacts_lender_id_fkey FOREIGN KEY (lender_id) REFERENCES public.bi_lenders(id) ON DELETE CASCADE;


--
-- Name: bi_lenders bi_lenders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_lenders
    ADD CONSTRAINT bi_lenders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.bi_users(id) ON DELETE RESTRICT;


--
-- Name: bi_marketing_replies bi_marketing_replies_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_replies
    ADD CONSTRAINT bi_marketing_replies_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.bi_contacts(id) ON DELETE CASCADE;


--
-- Name: bi_marketing_send_jobs bi_marketing_send_jobs_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_send_jobs
    ADD CONSTRAINT bi_marketing_send_jobs_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.bi_email_templates(id);


--
-- Name: bi_marketing_send_recipients bi_marketing_send_recipients_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_send_recipients
    ADD CONSTRAINT bi_marketing_send_recipients_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.bi_contacts(id) ON DELETE CASCADE;


--
-- Name: bi_marketing_send_recipients bi_marketing_send_recipients_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_marketing_send_recipients
    ADD CONSTRAINT bi_marketing_send_recipients_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.bi_marketing_send_jobs(id) ON DELETE CASCADE;


--
-- Name: bi_notes bi_notes_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_notes
    ADD CONSTRAINT bi_notes_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_purge_queue bi_purge_queue_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_purge_queue
    ADD CONSTRAINT bi_purge_queue_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_questions bi_questions_depends_on_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_questions
    ADD CONSTRAINT bi_questions_depends_on_key_fkey FOREIGN KEY (depends_on_key) REFERENCES public.bi_questions(question_key) ON DELETE SET NULL;


--
-- Name: bi_referrals bi_referrals_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrals
    ADD CONSTRAINT bi_referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.bi_referrers(id) ON DELETE RESTRICT;


--
-- Name: bi_referrer_agreements bi_referrer_agreements_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrer_agreements
    ADD CONSTRAINT bi_referrer_agreements_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.bi_referrers(id) ON DELETE CASCADE;


--
-- Name: bi_referrer_commissions bi_referrer_commissions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrer_commissions
    ADD CONSTRAINT bi_referrer_commissions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE SET NULL;


--
-- Name: bi_referrer_commissions bi_referrer_commissions_bi_commission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrer_commissions
    ADD CONSTRAINT bi_referrer_commissions_bi_commission_id_fkey FOREIGN KEY (bi_commission_id) REFERENCES public.bi_commissions(id);


--
-- Name: bi_referrer_commissions bi_referrer_commissions_referral_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrer_commissions
    ADD CONSTRAINT bi_referrer_commissions_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES public.bi_referrals(id);


--
-- Name: bi_referrer_commissions bi_referrer_commissions_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrer_commissions
    ADD CONSTRAINT bi_referrer_commissions_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.bi_referrers(id);


--
-- Name: bi_referrers bi_referrers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrers
    ADD CONSTRAINT bi_referrers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.bi_users(id) ON DELETE RESTRICT;


--
-- Name: bi_requirements bi_requirements_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_requirements
    ADD CONSTRAINT bi_requirements_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_requirements_history bi_requirements_history_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_requirements_history
    ADD CONSTRAINT bi_requirements_history_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE CASCADE;


--
-- Name: bi_requirements_history bi_requirements_history_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_requirements_history
    ADD CONSTRAINT bi_requirements_history_requirement_id_fkey FOREIGN KEY (requirement_id) REFERENCES public.bi_requirements(id) ON DELETE CASCADE;


--
-- Name: bi_sequence_enrollments bi_sequence_enrollments_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_enrollments
    ADD CONSTRAINT bi_sequence_enrollments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.bi_contacts(id) ON DELETE CASCADE;


--
-- Name: bi_sequence_enrollments bi_sequence_enrollments_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_enrollments
    ADD CONSTRAINT bi_sequence_enrollments_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.bi_sequences(id) ON DELETE CASCADE;


--
-- Name: bi_sequence_events bi_sequence_events_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_events
    ADD CONSTRAINT bi_sequence_events_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.bi_sequence_enrollments(id) ON DELETE CASCADE;


--
-- Name: bi_sequence_events bi_sequence_events_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_events
    ADD CONSTRAINT bi_sequence_events_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.bi_sequence_steps(id) ON DELETE SET NULL;


--
-- Name: bi_sequence_sends bi_sequence_sends_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_sends
    ADD CONSTRAINT bi_sequence_sends_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.bi_sequence_enrollments(id) ON DELETE CASCADE;


--
-- Name: bi_sequence_steps bi_sequence_steps_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sequence_steps
    ADD CONSTRAINT bi_sequence_steps_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.bi_sequences(id) ON DELETE CASCADE;


--
-- Name: bi_suppressions bi_suppressions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_suppressions
    ADD CONSTRAINT bi_suppressions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.bi_contacts(id) ON DELETE CASCADE;


--
-- Name: bi_applications fk_bi_applications_referral; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT fk_bi_applications_referral FOREIGN KEY (referral_id) REFERENCES public.bi_referrals(id) ON DELETE SET NULL;


--
-- Name: bi_applications fk_bi_applications_referrer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_applications
    ADD CONSTRAINT fk_bi_applications_referrer FOREIGN KEY (referrer_id) REFERENCES public.bi_referrers(id) ON DELETE SET NULL;


--
-- Name: bi_referrals fk_bi_referrals_application; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_referrals
    ADD CONSTRAINT fk_bi_referrals_application FOREIGN KEY (application_id) REFERENCES public.bi_applications(id) ON DELETE SET NULL;


--
-- Name: lender_uploads lender_uploads_lender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lender_uploads
    ADD CONSTRAINT lender_uploads_lender_id_fkey FOREIGN KEY (lender_id) REFERENCES public.lenders(id);


--
-- Name: referrals referrals_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.referrers(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 5H44LPpZ2vn50qsdC7I8cdMWbvIO8y7vacnkH2QnjEuNSZSfjnV9lzRcNxGL87B

