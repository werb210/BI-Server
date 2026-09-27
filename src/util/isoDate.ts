// BI_SERVER_BLOCK_v586_BF_HANDOFF_DATES
// bi_applications.formation_date / guarantor_dob (and bi_co_guarantors.date_of_birth) are DATE
// columns. BF sends whatever its wizard captured: a full date, or just the year a business
// started ("2015", the Accord LOC "Year began operations" field), sometimes "2015-06" or
// "June 2015". Any of those non-dates made the whole insert fail, so the BI application was
// never created. This turns what it can into YYYY-MM-DD and anything unreadable into null; the
// raw value is still kept in the application's data JSON.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function valid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{4})$/.exec(v);
  if (m) return valid(+m[1], 1, 1);
  m = /^(\d{4})[-/](\d{1,2})$/.exec(v);
  if (m) return valid(+m[1], +m[2], 1);
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(v);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) return valid(y, b, a); // DD/MM/YYYY
    if (b > 12 && a <= 12) return valid(y, a, b); // MM/DD/YYYY
    return null; // 03/04/1980 could be either - do not guess
  }
  m = /^([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(v);
  if (m) {
    const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return i >= 0 ? valid(+m[2], i + 1, 1) : null;
  }
  return null;
}
