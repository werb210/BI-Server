// BI_SERVER_BF_CO_APPLICANT_v391 - the BF co-applicant arrives on the
// /applications/from-bf handoff (BF-Server v390) as a co-guarantor. It lands in
// bi_co_guarantors when every column that table requires is present; otherwise
// it is kept on the application's data (so staff still see who it is) and
// completed later. Either way has_co_guarantors is set.
export type BfCoGuarantor = {
  first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
  date_of_birth: string | null; address: string | null; city: string | null; province: string | null;
  postal_code: string | null; ownership: number | null; relationship: string;
};

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, 200) : null;
}

/** ISO date (YYYY-MM-DD) from the common BF formats, or null. */
export function isoDate(v: unknown): string | null {
  const t = str(v);
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); // MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function normalizeBfCoGuarantors(raw: unknown): BfCoGuarantor[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g) => g && typeof g === "object")
    .map((g: any) => ({
      first_name: str(g.first_name),
      last_name: str(g.last_name),
      email: str(g.email)?.toLowerCase() ?? null,
      phone: str(g.phone),
      date_of_birth: isoDate(g.date_of_birth),
      address: str(g.address),
      city: str(g.city),
      province: str(g.province)?.toUpperCase() ?? null,
      postal_code: str(g.postal_code),
      ownership: typeof g.ownership === "number" && Number.isFinite(g.ownership) ? g.ownership : null,
      relationship: str(g.relationship) ?? "Co-applicant",
    }))
    .filter((g) => g.first_name || g.last_name)
    .slice(0, 4);
}

/** bi_co_guarantors has NOT NULL on every column and refuses QC. */
export function isCompleteCoGuarantor(g: BfCoGuarantor): boolean {
  return Boolean(
    g.first_name && g.last_name && g.email && g.phone && g.date_of_birth &&
    g.address && g.city && g.province && g.postal_code && g.province !== "QC",
  );
}
