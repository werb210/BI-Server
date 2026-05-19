# OTP Audit — BI-Server (working baseline) vs BF-Server (broken comparator)

Date: 2026-05-19  
Branch: audit/otp-2026-05-19  
Mode requested: read-only audit

## Scope and commands run

1. OTP path discovery:

```bash
git ls-files | xargs grep -nE 'otp|verify|TWILIO_VERIFY|twilio\.verify|verifications\.create' --include='*.ts' --include='*.js' 2>/dev/null
```

2. Direct source inspection for:
- `/api/v1/auth/otp/start` equivalent handlers (BI currently exposes `/api/v1/otp/request`, `/api/v1/lender/otp/start`, `/lender/otp/start`, `/referrer/otp/start`)
- OTP verify handlers
- phone normalization
- Twilio verify service wrapper
- allowlist / country filter / rate limit logic around OTP-adjacent flows

## Step 1: OTP code paths found (key files)

- `src/services/otpService.ts` (single Twilio Verify wrapper for SMS + email channels).
- `src/routes/biAuthRoutes.ts` (`/otp/request`, `/otp/verify` under `/api/v1`).
- `src/routes/biLenderAuthRoutes.ts` (`/api/v1/lender/otp/start`, `/api/v1/lender/otp/verify`).
- `src/routes/biLenderApiRoutes.ts` (`/lender/otp/start`, `/lender/otp/verify`).
- `src/routes/biReferrerRoutes.ts` (`/referrer/otp/start`, `/referrer/otp/verify`).
- `src/util/phoneE164.ts` (shared normalization utility).
- `src/platform/env.ts` (`TWILIO_VERIFY_SERVICE_SID` and related env declarations).

## Step 2: Full OTP flow details (working BI behavior)

### A) OTP service used by all SMS OTP flows

`src/services/otpService.ts`:
- Twilio client is enabled only when all 3 exist:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_VERIFY_SERVICE_SID`
- SMS send:
  - `client.verify.v2.services(serviceSid).verifications.create({ to: phone, channel: "sms" })`
- SMS verify:
  - `client.verify.v2.services(serviceSid).verificationChecks.create({ to: phone, code })`
  - approved when `result.status === "approved"`
- Non-prod fallback:
  - returns mock send result
  - permits `code === "000000"` only when `ALLOW_DEV_OTP === "true"`
- Safe wrappers (`sendOtpSafe`, `verifyOtpSafe`) prevent throwing and standardize `{ok:false,error}` behavior returned as 502 by routes.

### B) “Auth” applicant-style OTP routes

`src/routes/biAuthRoutes.ts`:
- Start endpoint: `POST /otp/request` (mounted under `/api/v1` in `server.ts` comments).
- Verify endpoint: `POST /otp/verify`.
- Start flow:
  - validates `phone`, `name`, `email`
  - enforces userType allowlist (`applicant|referrer|lender`)
  - applies per-phone and per-IP burst checks from `bi_otp_sessions`
  - calls `sendOtpSafe(phone)`
  - records OTP request + activity log.
- Verify flow:
  - calls `verifyOtpSafe(phone, code)`
  - fails with 400/502 if invalid or Twilio error
  - reads latest OTP session and resolves user type
  - creates `bi_users` row if needed
  - signs staff token and returns session payload.

### C) Lender OTP routes used by lender login

Two active lender OTP surfaces:

1) `src/routes/biLenderAuthRoutes.ts`
- `POST /api/v1/lender/otp/start`
- `POST /api/v1/lender/otp/verify`
- SMS path uses `sendOtpSafe/verifyOtpSafe` (Twilio Verify)
- Email path uses DB table `bi_otp_codes` + SendGrid (not Twilio Verify email)

2) `src/routes/biLenderApiRoutes.ts`
- `POST /lender/otp/start`
- `POST /lender/otp/verify`
- SMS path uses `sendOtpSafe/verifyOtpSafe` (Twilio Verify)
- Email path uses `sendEmailOtpSafe/verifyEmailOtpSafe` (Twilio Verify email channel)
- Phone path requires normalized E.164 and pre-provisioned active lender login contact.

### D) Referrer OTP routes

`src/routes/biReferrerRoutes.ts`:
- `POST /referrer/otp/start`: normalizes phone, sends OTP with `sendOtpSafe`.
- `POST /referrer/otp/verify`: normalizes phone, verifies OTP with `verifyOtpSafe`, auto-creates `bi_referrers` row when missing, returns JWT.

### E) Phone normalization

Shared utility in `src/util/phoneE164.ts` (used by lender API routes, referrer routes, applicant OTP routes):
- accepts strict E.164 with leading `+` and 8–15 digits
- converts 10-digit NANP to `+1XXXXXXXXXX`
- converts 11-digit starting with `1` to `+1...`
- otherwise returns `null` (route sends 400)

Note: `src/routes/biLenderAuthRoutes.ts` also contains its own local `normalizeE164` (very similar but not imported from shared util).

## Step 3: Twilio Verify Service SID comparison with BF-Server

### BI-Server
- BI uses a single env var key: `TWILIO_VERIFY_SERVICE_SID` (`src/platform/env.ts` + `src/services/otpService.ts`).
- All Twilio Verify calls in BI route through this variable.

### BF-Server (requested comparison)
- This repository does **not** include BF-Server code or BF deployment env values.
- Therefore, from BI repo alone we **cannot** determine BF’s configured `TWILIO_VERIFY_SERVICE_SID` value or whether it matches BI.

### Required to complete BF-vs-BI SID parity check
- Need BF-Server:
  - either source file(s) where OTP service is configured, and/or
  - runtime env/config (e.g., Azure App Settings / secrets store) showing BF `TWILIO_VERIFY_SERVICE_SID`.
- Then compare exact SID string values (typically `VA...`) between BI and BF environments.

## Step 4: Allowlist / country filter / rate limit observations

### Allowlist logic
- Present in `src/routes/biAuthRoutes.ts` on `/otp/request`:
  - `userType` restricted to `applicant|referrer|lender`.

### Rate limiting / throttling logic
- Present in `src/routes/biAuthRoutes.ts` on `/otp/request`:
  - max 2 requests per phone in 10 minutes
  - max 10 requests per IP in 10 minutes
- No equivalent explicit OTP burst limit observed in `biReferrerRoutes.ts` and `biLenderApiRoutes.ts` OTP endpoints (beyond “only send if active contact exists” checks).

### Country filter logic
- No country gate inside OTP handlers.
- Country filters exist elsewhere (e.g., lender/public application submission requiring `country === "CA"`), but not in OTP send/verify code paths.

## Working BI flow vs likely BF failure points (diff-style checklist)

Given BI’s working behavior, BF breakage is commonly one of:
1. Wrong/missing `TWILIO_VERIFY_SERVICE_SID` (or account/token mismatch for that SID).
2. Phone format not normalized to E.164 before Twilio Verify call.
3. Channel mismatch (SMS vs email path inconsistent with Verify service channel enablement).
4. Non-throw-safe OTP wrapper differences causing swallowed or mis-mapped errors.
5. Route-level differences (e.g., contacting unregistered identifiers, different contact lookup tables, or stricter preconditions).

BI specifically hardens (1)/(2)/(4) via:
- centralized `otpService.ts`
- shared `normalizeE164` utility
- `sendOtpSafe/verifyOtpSafe` result wrappers.

## Direct answer to “are BI and BF on same Verify service?”

Not determinable from BI repo alone. BI code references the key `TWILIO_VERIFY_SERVICE_SID`, but the actual runtime SID value and BF’s corresponding value are external configuration and are not checked into this repository.
