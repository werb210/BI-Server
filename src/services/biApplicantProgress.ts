// BI_SERVER_APPLICANT_PROGRESS_v279
// The applicant-facing progress view for BI-Client. Stage and status values
// have two generations in this database (see BI_STAGES_PGI_vs_STAFF.md), so
// both columns are mapped and the furthest point reached wins.

export const PROGRESS_STEPS = [
  { key: "application", label: "Application" },
  { key: "documents", label: "Documents" },
  { key: "sent", label: "Sent to insurer" },
  { key: "review", label: "Insurer review" },
  { key: "decision", label: "Decision" },
  { key: "policy", label: "Policy issued" },
] as const;

const POSITION: Record<string, number> = {
  created: 0, in_progress: 0, new_application: 0,
  documents_pending: 1, document_review: 1, docs_rejected: 1,
  ready_for_submission: 2, submitted: 2, sent_to_pgi: 2, submitted_to_carrier: 2,
  under_review: 3, received: 3, information_required: 3,
  quoted: 4, approved: 4, declined: 4,
  bound: 5, policy_issued: 5,
};

export type StepState = "done" | "current" | "upcoming" | "attention" | "stopped";
export type ApplicantProgress = {
  publicId: string | null;
  headline: string;
  detail: string;
  steps: Array<{ key: string; label: string; state: StepState }>;
  updatedAt: string | null;
};

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export function buildApplicantProgress(app: { public_id?: string | null; stage?: string | null; status?: string | null; updated_at?: string | Date | null }): ApplicantProgress {
  const stage = norm(app.stage);
  const status = norm(app.status);
  const values = [stage, status];
  const cancelled = values.includes("cancelled");
  const declined = values.includes("declined");
  const attention = values.includes("information_required") || values.includes("docs_rejected");
  let pos = Math.max(...values.map((v) => (v in POSITION ? POSITION[v] : -1)), 0);
  if (declined) pos = 4;

  const steps = PROGRESS_STEPS.map((s, i) => {
    let state: StepState = i < pos ? "done" : i === pos ? "current" : "upcoming";
    if (i === pos && attention) state = "attention";
    if (i === pos && (declined || cancelled)) state = "stopped";
    if (pos === 5 && i === 5) state = "done";
    return { key: s.key, label: s.label, state };
  });

  let headline: string;
  let detail: string;
  if (cancelled) { headline = "Application cancelled"; detail = "This application is no longer active. Contact us if you'd like to start again."; }
  else if (declined) { headline = "The insurer declined this application"; detail = "Our team will be in touch to explain the decision and your options."; }
  else if (values.includes("docs_rejected")) { headline = "A document needs replacing"; detail = "Check the list below and upload a new copy."; }
  else if (values.includes("information_required")) { headline = "The insurer needs more information"; detail = "Our team will contact you with exactly what's needed."; }
  else if (pos === 5) { headline = "Your policy is issued"; detail = "You're covered. Your policy documents will be sent to you."; }
  else if (pos === 4) { headline = "Your quote is ready"; detail = "Our team will walk you through the quote and next steps."; }
  else if (pos === 3) { headline = "The insurer is reviewing your application"; detail = "Most reviews take a few business days. We'll let you know as soon as there's an update."; }
  else if (pos === 2) { headline = "Your application is with the insurer"; detail = "We've sent everything to the insurer for review."; }
  else if (pos === 1) { headline = "We're reviewing your documents"; detail = "We'll send your application to the insurer once your documents are accepted."; }
  else { headline = "Finish your application"; detail = "Complete the remaining steps below to submit."; }

  const updated = app.updated_at ? new Date(app.updated_at) : null;
  return { publicId: app.public_id ?? null, headline, detail, steps, updatedAt: updated && !isNaN(updated.getTime()) ? updated.toISOString() : null };
}
