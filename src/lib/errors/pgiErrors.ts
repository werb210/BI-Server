// BI_HARDENING_v44 — Structured error class for PGI submission validation failures.
// Replaces `throw new Error("Missing required form_data fields...")` so route
// handlers can surface a 400 with machine-readable body instead of a 500.
export class PgiValidationError extends Error {
  readonly status = 400;
  constructor(public readonly missingFields: string[]) {
    super(`PGI submission missing required fields: ${missingFields.join(", ")}`);
    this.name = "PgiValidationError";
  }
}

export function isPgiValidationError(e: unknown): e is PgiValidationError {
  return e instanceof PgiValidationError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "PgiValidationError");
}
