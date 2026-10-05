// BI_SERVER_LOGGED_FALLBACKS_v712
// A query that falls back to a default when it fails must say so in the log. A bare catch
// returning empty rows turns a database error into "no such record" with no trace: a
// client's sign-in, profile or contract lookup silently came back empty.

export function loggedFallback<T>(tag: string, fallback: T): (err: unknown) => T {
  return (err: unknown): T => {
    console.warn("[query-fallback] " + tag + ": " + (err instanceof Error ? err.message : String(err)));
    return fallback;
  };
}
