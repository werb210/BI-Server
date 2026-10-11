// BI_SERVER_v789_LOG_MASKING - personal data in logs is masked.
//   phone: only the last 4 digits ("***-***-1234")
//   email: first letter + domain ("j***@example.com")

export function maskPhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return `***${digits.slice(-4)}`;
}

export function maskEmail(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const at = s.lastIndexOf("@");
  if (at <= 0) return s ? "***" : "";
  return `${s[0]}***${s.slice(at)}`;
}

/** Truncate an upstream error body before it is logged. */
export function truncateForLog(raw: unknown, max = 500): string {
  const s = typeof raw === "string" ? raw : (() => { try { return JSON.stringify(raw); } catch { return String(raw); } })();
  return s.length > max ? `${s.slice(0, max)}...[truncated ${s.length - max} chars]` : s;
}
