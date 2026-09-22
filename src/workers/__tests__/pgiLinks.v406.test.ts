// BI_SERVER_PGI_LINKS_v406
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resumeUrl, startUrl } from "../abandonedApplicationNudge";

describe("PGI links in texts go to the live site", () => {
  it("resume link goes through www login to the application form", () => {
    expect(resumeUrl("abc-123")).toBe("https://www.boreal.insure/login?next=/applications/abc-123/form");
    expect(startUrl()).toBe("https://www.boreal.insure/applications/new");
  });
  it("no bare boreal.insure links remain in the nudge texts", () => {
    const src = readFileSync(join(process.cwd(), "src/workers/abandonedApplicationNudge.ts"), "utf8");
    expect(src).not.toMatch(/https:\/\/boreal\.insure/);
  });
});
