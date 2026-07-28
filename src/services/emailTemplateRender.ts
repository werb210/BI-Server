export interface BrandedEmailTemplate {
  subject?: string;
  headline?: string;
  heroUrl?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] as string));

const safeUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? escapeHtml(url.toString()) : undefined;
  } catch { return undefined; }
};

export function renderEmailTemplate(template: BrandedEmailTemplate): string {
  const headline = escapeHtml(template.headline || "Boreal Risk Management");
  const body = escapeHtml(template.body || "").replace(/\r?\n/g, "<br>");
  const hero = safeUrl(template.heroUrl);
  const cta = safeUrl(template.ctaUrl);
  const button = cta && template.ctaLabel
    ? `<p style="margin:28px 0"><a href="${cta}" style="background:#16324f;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">${escapeHtml(template.ctaLabel)}</a></p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f3f5f7;font-family:Arial,sans-serif;color:#17212b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff"><tr><td style="padding:24px 32px;background:#16324f;color:#fff;font-size:20px;font-weight:700">BOREAL</td></tr>${hero ? `<tr><td><img src="${hero}" alt="" width="600" style="display:block;width:100%;height:auto"></td></tr>` : ""}<tr><td style="padding:36px 32px"><h1 style="margin:0 0 20px;font-size:28px">${headline}</h1><div style="font-size:16px;line-height:1.6">${body}</div>${button}</td></tr><tr><td style="padding:20px 32px;background:#eef1f3;color:#52606d;font-size:12px">Boreal Risk Management</td></tr></table></td></tr></table></body></html>`;
}
