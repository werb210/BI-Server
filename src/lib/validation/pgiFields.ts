// BI_PGI_ALIGNMENT_v56 — single source of truth for PGI form_data validation.
export const ALLOWED_COUNTRIES = ["CA", "US"] as const;
export type AllowedCountry = typeof ALLOWED_COUNTRIES[number];
export type PgiFormData = { country: AllowedCountry; naics_code: string; formation_date: string; loan_amount: number; pgi_limit: number; annual_revenue: number; ebitda: number; total_debt: number; monthly_debt_service: number; collateral_value: number; enterprise_value: number; bankruptcy_history: boolean; insolvency_history: boolean; judgment_history: boolean; };
export type PgiSubmission = { guarantor_name: string; guarantor_email: string; business_name: string; lender_name?: string; form_data: PgiFormData; };
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/; const NAICS_RE = /^\d{6}$/; const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export type ValidationIssue = { field: string; message: string };
function pushNum(out: ValidationIssue[], field: string, v: unknown, opts: { positive?: boolean; nonNegative?: boolean; allowNegative?: boolean }): number | null { if (typeof v !== "number" || !Number.isFinite(v)) { out.push({ field, message: `${field} must be a number` }); return null; } if (opts.positive && v <= 0) { out.push({ field, message: `${field} must be > 0` }); return null; } if (opts.nonNegative && v < 0) { out.push({ field, message: `${field} must be >= 0` }); return null; } return v; }
export function validatePgiSubmission(input: unknown): { ok: true; value: PgiSubmission } | { ok: false; issues: ValidationIssue[] } {
const issues: ValidationIssue[] = []; const s = (input ?? {}) as Record<string, unknown>;
if (typeof s.guarantor_name !== "string" || !s.guarantor_name.trim()) issues.push({ field: "guarantor_name", message: "required" });
if (typeof s.guarantor_email !== "string" || !EMAIL_RE.test(s.guarantor_email)) issues.push({ field: "guarantor_email", message: "must be a valid email" });
if (typeof s.business_name !== "string" || !s.business_name.trim()) issues.push({ field: "business_name", message: "required" });
const fd = (s.form_data ?? {}) as Record<string, unknown>;
if (typeof fd.country !== "string" || !(ALLOWED_COUNTRIES as readonly string[]).includes(fd.country)) issues.push({ field: "form_data.country", message: `must be one of ${ALLOWED_COUNTRIES.join(", ")}` });
if (typeof fd.naics_code !== "string" || !NAICS_RE.test(fd.naics_code)) issues.push({ field: "form_data.naics_code", message: "must be a 6-digit NAICS code" });
if (typeof fd.formation_date !== "string" || !ISO_DATE_RE.test(fd.formation_date)) issues.push({ field: "form_data.formation_date", message: "must be YYYY-MM-DD" });
const loan = pushNum(issues, "form_data.loan_amount", fd.loan_amount, { positive: true }); const limit = pushNum(issues, "form_data.pgi_limit", fd.pgi_limit, { positive: true }); if (loan !== null && limit !== null && limit > loan) issues.push({ field: "form_data.pgi_limit", message: "pgi_limit cannot exceed loan_amount" });
pushNum(issues, "form_data.annual_revenue", fd.annual_revenue, { positive: true }); pushNum(issues, "form_data.ebitda", fd.ebitda, { allowNegative: true }); pushNum(issues, "form_data.total_debt", fd.total_debt, { nonNegative: true }); pushNum(issues, "form_data.monthly_debt_service", fd.monthly_debt_service, { nonNegative: true }); pushNum(issues, "form_data.collateral_value", fd.collateral_value, { nonNegative: true }); pushNum(issues, "form_data.enterprise_value", fd.enterprise_value, { nonNegative: true });
for (const k of ["bankruptcy_history", "insolvency_history", "judgment_history"] as const) if (typeof fd[k] !== "boolean") issues.push({ field: `form_data.${k}`, message: "must be boolean" });
if (issues.length) return { ok: false, issues }; return { ok: true, value: s as unknown as PgiSubmission }; }
