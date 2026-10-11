// BI_SERVER_BLOCK_v789_SCHEMA_DRIFT_v2 - behaviour of scripts/check-schema-drift.mjs: it is run
// against fixture sources written to a temp dir (never against the repo's own src text).
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCHEMA = {
  _comment: ["fixture"],
  bi_documents: ["id", "application_id", "doc_type", "created_at", "purged_at", "review_status"],
  bi_applications: ["id", "status", "created_at", "lender_id"],
};

type Problem = { file: string; line: number; table: string; column: string; clause: string };
let check: (root: string, schema: unknown) => { problems: Problem[] };

function run(files: Record<string, string>): Problem[] {
  const root = mkdtempSync(path.join(tmpdir(), "bi-drift-"));
  const src = path.join(root, "src");
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    writeFileSync(path.join(src, rel), text);
  }
  return check(src, SCHEMA).problems;
}

beforeAll(async () => {
  // @ts-expect-error - plain .mjs script, no type declarations
  const mod = await import("../../scripts/check-schema-drift.mjs");
  check = mod.checkSource;
});

describe("check-schema-drift (v789)", () => {
  it("flags ORDER BY on a column bi_documents does not have, with file:line", () => {
    const problems = run({
      "routes/docs.ts": [
        "import { pool } from '../db';",
        "export async function list(id: string) {",
        "  return pool.query(`SELECT id, doc_type",
        "      FROM bi_documents",
        "     WHERE application_id = $1 AND purged_at IS NULL",
        "     ORDER BY uploaded_at`, [id]);",
        "}",
      ].join("\n"),
    });
    expect(problems).toEqual([expect.objectContaining({ file: "src/routes/docs.ts", line: 6, table: "bi_documents", column: "uploaded_at", clause: "ORDER BY" })]);
  });

  it("checks aliased columns in joins, UPDATE SET, WHERE, INSERT and ON CONFLICT SET", () => {
    const problems = run({
      "a.ts": [
        "const q1 = `SELECT d.id, a.nope FROM bi_documents d JOIN bi_applications a ON a.id = d.application_id`;",
        "const q2 = `UPDATE bi_applications SET status = $1, bogus = NOW() WHERE id = $2 AND missing_col = 1`;",
        "const q3 = `INSERT INTO bi_documents (id, wrong) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.not_here`;",
      ].join("\n"),
    });
    const got = problems.map((p) => `${p.line}:${p.table}.${p.column}`).sort();
    expect(got).toEqual(["1:bi_applications.nope", "2:bi_applications.bogus", "2:bi_applications.missing_col", "3:bi_documents.not_here", "3:bi_documents.wrong"].sort());
  });

  it("does not guess: functions, casts, params, output aliases, sub-selects and unknown tables pass", () => {
    const problems = run({
      "b.ts": [
        "const q1 = `SELECT COUNT(*) AS n, MAX(created_at) latest FROM bi_documents WHERE review_status::text = ANY($1::text[]) AND created_at > NOW() - INTERVAL '1 day' ORDER BY n DESC`;",
        "const q2 = `SELECT x FROM (SELECT id AS x FROM bi_documents) s ORDER BY x`;",
        "const q3 = `SELECT whatever FROM some_view WHERE anything = 1`;",
        "const q4 = `SELECT id FROM bi_applications WHERE EXTRACT(EPOCH FROM created_at) > 0 AND status IS DISTINCT FROM 'x'`;",
        "const msg = 'please select a lender from the list';",
      ].join("\n"),
    });
    expect(problems).toEqual([]);
  });

  it("skips test directories", () => {
    const problems = run({ "routes/__tests__/x.test.ts": "const q = `SELECT nope FROM bi_documents`;" });
    expect(problems).toEqual([]);
  });
});
