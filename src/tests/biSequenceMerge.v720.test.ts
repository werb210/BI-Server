// BI_SERVER_BLOCK_v720
import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
import { sequenceMergeValues } from "../workers/marketingWorker";
import { mergeFields } from "../services/biSendgridService";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("sequence emails fill merge fields", () => {
  it("replaces {{first_name}} in subject and body", () => {
    const v = sequenceMergeValues({ contact_first_name: "Todd", contact_full_name: "Todd Werboweski", contact_company: "Boreal", contact_email: "todd@werboweski.com" });
    expect(mergeFields("{{first_name}}, the application is quicker now", v)).toBe("Todd, the application is quicker now");
    expect(mergeFields("Hi {{ first_name }} at {{company}}", v)).toBe("Hi Todd at Boreal");
  });
  it("uses the first word of the full name when there is no first name", () => {
    expect(sequenceMergeValues({ contact_full_name: "Todd Werb" }).first_name).toBe("Todd");
  });
  it("the worker merges before sending", () => {
    const w = readFileSync(resolve(__dirname, "../workers/marketingWorker.ts"), "utf8");
    expect(w).toContain("mergeFields(content.subject, merge), mergeFields(content.body, merge)");
    expect(w).toContain("c.first_name AS contact_first_name");
  });
});
