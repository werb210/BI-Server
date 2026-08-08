// BI_SERVER_US_APPLICATIONS_v21
// The public application endpoint hard-rejected anything that was not country
// "CA". The carrier now writes United States business, so the gate becomes a
// two-country gate rather than being removed: an unknown country must still be
// refused, and a region code must still be validated against the country it
// claims to belong to, or "ON" passes as a US state.
//
// bi_applications.country already exists and the province check constraint is
// only `<> 'QC'`, so US state codes store without a migration.

/** Canada, less Quebec - the carrier does not write PGI there. */
export const CA_REGIONS = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "SK", "YT",
] as const;

/** Quebec is refused separately so the error can say why. */
export const CA_EXCLUDED_REGIONS = ["QC"] as const;

export const US_REGIONS = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
] as const;

export type SupportedCountry = "CA" | "US";

export function isSupportedCountry(value: unknown): value is SupportedCountry {
  return value === "CA" || value === "US";
}

export function regionsFor(country: SupportedCountry): readonly string[] {
  return country === "US" ? US_REGIONS : CA_REGIONS;
}

/**
 * Canadian postal codes and US ZIP codes have different shapes, and accepting
 * either for either country silently corrupts the address on file.
 */
export function isValidPostalCode(country: SupportedCountry, value: unknown): boolean {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return false;
  return country === "US"
    ? /^\d{5}(-?\d{4})?$/.test(raw)
    : /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(raw);
}

export type RegionCheck = { ok: true } | { ok: false; error: string; message: string };

export function checkRegion(country: SupportedCountry, region: unknown): RegionCheck {
  const code = String(region ?? "").trim().toUpperCase();
  if (!code) return { ok: false, error: "region_required", message: "A province or state is required." };
  if (country === "CA" && (CA_EXCLUDED_REGIONS as readonly string[]).includes(code)) {
    return { ok: false, error: "quebec_blocked", message: "PGI does not currently write business in Quebec." };
  }
  if (!regionsFor(country).includes(code)) {
    return {
      ok: false,
      error: "region_unsupported",
      message: `${code} is not a recognised ${country === "US" ? "state" : "province"}.`,
    };
  }
  return { ok: true };
}
