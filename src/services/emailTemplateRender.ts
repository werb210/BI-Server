// BI_EMAIL_FRAME_PARITY_v1 - BF-compatible Boreal-branded email frame with an optional second column.
export interface BrandedEmailTemplate {
  subject?: string;
  headline?: string; heroUrl?: string; heroLink?: string; body?: string;
  ctaLabel?: string; ctaUrl?: string; image2Url?: string; image2Link?: string;
  headline2?: string; body2?: string;
  secondHeadline?: string; secondBody?: string;
  rightHeadline?: string; rightBody?: string; rightImageUrl?: string; rightImageLink?: string;
}

const BRAND = "#1E3A8A";
const ADDRESS = "450 Sparling Crt SW, Edmonton, AB T6X 1G9";

function esc(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function attr(value: string): string {
  return String(value || "").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function bodyHtml(value: string): string {
  const escaped = esc(value);
  const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${attr(url)}" style="color:${BRAND};">${url}</a>`);
  return linked.replace(/\r?\n/g, "<br>");
}
function image(url: string, link: string): string {
  if (!url) return "";
  const tag = `<img src="${attr(url)}" alt="" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:6px;">`;
  const inner = link ? `<a href="${attr(link)}" target="_blank">${tag}</a>` : tag;
  return `<tr><td style="padding:20px 28px 0;">${inner}</td></tr>`;
}
function column(headline: string, body: string, imageUrl: string, imageLink: string): string {
  const heading = headline ? `<h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.3;color:${BRAND};">${esc(headline)}</h1>` : "";
  const imageTag = imageUrl ? `<img src="${attr(imageUrl)}" alt="" width="264" style="display:block;width:100%;max-width:264px;height:auto;border:0;border-radius:6px;">` : "";
  const linkedImage = imageTag && imageLink ? `<a href="${attr(imageLink)}" target="_blank">${imageTag}</a>` : imageTag;
  const copy = body ? `<div style="padding-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#333333;">${bodyHtml(body)}</div>` : "";
  return `${heading}${linkedImage}${copy}`;
}

export function renderEmailTemplate(template: BrandedEmailTemplate): string {
  const headline = template.headline ? `<tr><td style="padding:28px 28px 0;"><h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.3;color:${BRAND};">${esc(template.headline)}</h1></td></tr>` : "";
  const hero = image(template.heroUrl || "", template.heroLink || "");
  const body = template.body ? `<tr><td style="padding:20px 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#333333;">${bodyHtml(template.body)}</td></tr>` : "";
  const cta = template.ctaLabel && template.ctaUrl ? `<tr><td style="padding:26px 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:${BRAND};"><a href="${attr(template.ctaUrl)}" target="_blank" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(template.ctaLabel)}</a></td></tr></table></td></tr>` : "";
  const secondImage = image(template.image2Url || "", template.image2Link || "");
  const secondHeadline = template.headline2 ?? template.secondHeadline ?? template.rightHeadline ?? "";
  const secondBody = template.body2 ?? template.secondBody ?? template.rightBody ?? "";
  const secondImageUrl = template.rightImageUrl ?? template.image2Url ?? "";
  const secondImageLink = template.rightImageLink ?? template.image2Link ?? "";
  const hasSecondColumn = Boolean(secondHeadline || secondBody || template.rightImageUrl);
  const columns = hasSecondColumn ? `<tr><td style="padding:28px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="email-column" width="264" valign="top" style="width:264px;">${column(template.headline || "", template.body || "", template.heroUrl || "", template.heroLink || "")}</td>
<td class="email-gutter" width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>
<td class="email-column" width="264" valign="top" style="width:264px;">${column(secondHeadline, secondBody, secondImageUrl, secondImageLink)}</td>
</tr></table></td></tr>` : "";
  const responsiveStyle = hasSecondColumn ? `<style>@media only screen and (max-width:620px){.email-column{display:block!important;width:100%!important;max-width:544px!important;}.email-gutter{display:block!important;width:100%!important;height:20px!important;}}</style>` : "";
  const logo = (process.env.PUBLIC_SERVER_URL || "https://server.boreal.financial") + "/api/public/email/logo.png";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${responsiveStyle}</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:${BRAND};padding:22px;text-align:center;"><img src="${logo}" alt="Boreal Risk Management" width="300" style="display:inline-block;width:300px;max-width:80%;height:auto;border:0;"></td></tr>
${hasSecondColumn ? columns : `${headline}${hero}${body}`}${cta}${hasSecondColumn ? "" : secondImage}
<tr><td style="padding:30px 28px 28px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;"><p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#6b7280;"><strong>Boreal Risk Management</strong><br>${ADDRESS}</p><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#9ca3af;">You received this email because you connected with Boreal Risk Management.</p></td></tr>
</table></td></tr></table></body></html>`;
}
