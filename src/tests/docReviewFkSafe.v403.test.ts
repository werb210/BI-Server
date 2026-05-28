import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const detail = readFileSync("src/routes/biApplicationDetailRoutes.ts", "utf-8");
const docs = readFileSync("src/routes/biDocumentRoutes.ts", "utf-8");

describe("v403 FK-safe bi_activity audit inserts", () => {
  it("accept/reject staff inserts FK-guard the actor", () => {
    expect(detail).toContain("VALUES($1, 'staff', (SELECT id FROM bi_users WHERE id = $2),");
    // no raw unguarded staff actor remains
    expect(detail).not.toContain("VALUES($1, 'staff', $2,");
  });
  it("system inserts (stage change, auto-submit) FK-guard the actor", () => {
    expect(detail).toContain("VALUES($1, 'system', (SELECT id FROM bi_users WHERE id = $2),");
    expect(detail).not.toContain("VALUES($1, 'system', $2,");
  });
  it("delete audit insert uses correct columns and FK-guards the actor", () => {
    expect(docs).toContain("INSERT INTO bi_activity (application_id, actor_type, actor_user_id, event_type, summary, meta)");
    expect(docs).toContain("'document_deleted', $3, $4::jsonb)");
    expect(docs).not.toContain("actor, actor_user_id, kind, message, metadata");
  });
});
