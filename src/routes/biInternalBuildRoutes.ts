// BI_SERVER_BUILD_TRUTH_v18
import { Router } from "express";
import { BUILD_TAG, CODE_VERSION, COMMIT_SHA } from "../platform/buildInfo";
import { renderEmailTemplate } from "../services/emailTemplateRender";
import { TEMPLATE_KEYS, templateFrom } from "./biMarketingEmailCompatRoutes";

const PROBE_LEFT_IMAGE = "https://probe.invalid/left.png";
const PROBE_RIGHT_IMAGE = "https://probe.invalid/right.png";
const PROBE_RIGHT_CTA = "https://probe.invalid/right-cta";

const PROBE_PAYLOAD: Record<string, string> = {
  subject: "probe",
  headline: "Left headline",
  heroUrl: PROBE_LEFT_IMAGE,
  heroLink: "https://probe.invalid/left-link",
  body: "Left body",
  ctaLabel: "Left CTA",
  ctaUrl: "https://probe.invalid/left-cta",
  headline2: "Right headline",
  body2: "Right body",
  rightImageUrl: PROBE_RIGHT_IMAGE,
  rightImageLink: "https://probe.invalid/right-link",
  cta2Label: "Right CTA",
  cta2Url: PROBE_RIGHT_CTA,
};

export function renderProbe(): {
  imgCount: number;
  heroImage: boolean;
  rightImage: boolean;
  secondCta: boolean;
  keysReceived: string[];
} {
  const template = templateFrom(PROBE_PAYLOAD);
  const html = renderEmailTemplate(template);
  return {
    imgCount: (html.match(/<img/g) || []).length,
    heroImage: html.includes(PROBE_LEFT_IMAGE),
    rightImage: html.includes(PROBE_RIGHT_IMAGE),
    secondCta: html.includes(PROBE_RIGHT_CTA),
    keysReceived: Object.entries(template)
      .filter(([, value]) => typeof value === "string" && value !== "")
      .map(([key]) => key)
      .sort(),
  };
}

const router: Router = Router();

router.get("/_int/build", (_req, res) => res.json({
  service: "bi-server",
  codeVersion: CODE_VERSION,
  buildTag: BUILD_TAG,
  commitSha: COMMIT_SHA,
  node: process.version,
  uptimeSeconds: Math.round(process.uptime()),
  biPublicBaseUrl: process.env.BI_PUBLIC_BASE_URL || null,
  sendgridConfigured: Boolean(process.env.SENDGRID_API_KEY),
  templateKeys: [...TEMPLATE_KEYS],
  renderProbe: renderProbe(),
  ts: new Date().toISOString(),
}));

export default router;
