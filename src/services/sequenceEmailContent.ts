// BI_SEQ_EMAIL_TEMPLATE_AT_SEND_v373
// On 2026-09-21 the first email step of "Test" reached BF-Server with an empty
// subject (400 to_and_subject_required). The step was built from a template,
// but the step routes stored only subject/body, and those were blank. The
// worker now fills a blank subject or body from the step's template at send
// time, and a step with no content at all is reported once instead of retried.
export type EmailContent = { subject: string; body: string };
export type TemplateLoader = (templateId: string) => Promise<{ subject: string | null; body: string | null } | null>;

export function templateIdOf(conditions: unknown): string | null {
  if (!conditions || typeof conditions !== "object") return null;
  const raw = (conditions as Record<string, unknown>).template_id;
  const id = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  return id || null;
}

export async function resolveEmailContent(
  step: { subject: string | null; body: string | null; conditions?: unknown },
  loadTemplate: TemplateLoader,
  templateId: string | null = templateIdOf(step.conditions),
): Promise<EmailContent | null> {
  let subject = (step.subject ?? "").trim();
  let body = (step.body ?? "").trim();
  if ((!subject || !body) && templateId) {
    const tpl = await loadTemplate(templateId);
    if (tpl) {
      subject = subject || (tpl.subject ?? "").trim();
      body = body || (tpl.body ?? "").trim();
    }
  }
  return subject && body ? { subject, body } : null;
}
