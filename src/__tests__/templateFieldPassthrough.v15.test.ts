// BI_SERVER_TEMPLATE_FIELD_PASSTHROUGH_v15
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderEmailTemplate } from "../services/emailTemplateRender.js";

const src = readFileSync("src/routes/biMarketingEmailCompatRoutes.ts", "utf8");

describe("templateFrom", () => {
  it("carries the second-column CTA that the old allowlist dropped", () => {
    expect(src).toContain('"cta2Label", "cta2Url"');
  });

  it("derives its key list from BrandedEmailTemplate so the two cannot drift", () => {
    expect(src).toContain("satisfies readonly (keyof BrandedEmailTemplate)[]");
  });

  it("no longer hand-builds the object field by field", () => {
    expect(src).not.toContain('subject: text("subject"), headline: text("headline")');
  });
});

describe("renderEmailTemplate two-column output", () => {
  const tpl = {
    subject: "s",
    headline: "Left head", body: "Left body",
    heroUrl: "https://example.test/left.png", heroLink: "https://example.test/l",
    ctaLabel: "Left CTA", ctaUrl: "https://example.test/lc",
    rightHeadline: "Right head", rightBody: "Right body",
    rightImageUrl: "https://example.test/right.png", rightImageLink: "https://example.test/r",
    cta2Label: "Right CTA", cta2Url: "https://example.test/rc",
  };
  const html = renderEmailTemplate(tpl);

  it("emits both column images", () => {
    expect(html).toContain('src="https://example.test/left.png"');
    expect(html).toContain('src="https://example.test/right.png"');
  });

  it("emits both column buttons", () => {
    expect(html).toContain("Left CTA");
    expect(html).toContain("Right CTA");
    expect(html).toContain('href="https://example.test/rc"');
  });

  it("omits an image element entirely when no url is given", () => {
    const bare = renderEmailTemplate({ subject: "s", headline: "h", body: "b", rightHeadline: "r", rightBody: "rb" });
    expect(bare).not.toContain('<img src=""');
  });
});
