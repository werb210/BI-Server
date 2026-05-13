// BI_SERVER_BLOCK_v250_MAYA_STAFF_PIPELINE_QUERY_v1
// Allowlist of canned BI-side pipeline queries that staff Maya
// can run. Same structure as BF-Server v214: keyword groups, all
// groups must match, canned SQL with no string interpolation of
// the question text. Unmatched questions return not_supported=true
// with the list of supported intents.
import { pool } from "../db";

type QueryDef = {
  key: string;
  label: string;
  keywords: ReadonlyArray<ReadonlyArray<string>>;
  sql: string;
  describe: (rows: ReadonlyArray<Record<string, unknown>>) => string;
};

const QUERIES: ReadonlyArray<QueryDef> = [
  {
    key: "submissions_this_week",
    label: "PGI applications submitted this week",
    keywords: [
      ["submission", "submissions", "submitted", "applications", "apps"],
      ["week", "weekly"],
    ],
    sql: `
      SELECT id, application_code, business_name, guarantor_name,
             stage, status, source, created_at
        FROM bi_applications
       WHERE created_at >= date_trunc('week', NOW())
       ORDER BY created_at DESC
       LIMIT 100
    `,
    describe: (rows) =>
      `${rows.length} PGI application(s) created this week.`,
  },
  {
    key: "submissions_today",
    label: "PGI applications submitted today",
    keywords: [
      ["submission", "submissions", "submitted", "applications", "apps"],
      ["today"],
    ],
    sql: `
      SELECT id, application_code, business_name, guarantor_name,
             stage, status, source, created_at
        FROM bi_applications
       WHERE created_at >= date_trunc('day', NOW())
       ORDER BY created_at DESC
       LIMIT 100
    `,
    describe: (rows) =>
      `${rows.length} PGI application(s) created today.`,
  },
  {
    key: "approvals_this_week",
    label: "PGI approvals this week",
    keywords: [
      ["approval", "approvals", "approved"],
      ["week"],
    ],
    sql: `
      SELECT id, application_code, business_name, guarantor_name,
             stage, status, updated_at
        FROM bi_applications
       WHERE stage = 'approved'
         AND updated_at >= date_trunc('week', NOW())
       ORDER BY updated_at DESC
       LIMIT 100
    `,
    describe: (rows) => `${rows.length} PGI approval(s) this week.`,
  },
  {
    key: "in_document_review",
    label: "PGI applications in document review",
    keywords: [
      ["document", "documents", "doc", "docs"],
      ["review", "reviewing", "pending"],
    ],
    sql: `
      SELECT id, application_code, business_name, guarantor_name,
             stage, status, updated_at
        FROM bi_applications
       WHERE stage = 'documents_pending'
          OR lower(COALESCE(status, '')) LIKE '%document_review%'
       ORDER BY updated_at DESC
       LIMIT 100
    `,
    describe: (rows) =>
      `${rows.length} PGI application(s) in document review.`,
  },
  {
    key: "bf_referrals",
    label: "PGI applications referred from BF",
    keywords: [
      ["bf", "boreal", "financial", "referral", "referred", "handoff"],
      ["application", "applications", "apps", "deal", "deals"],
    ],
    sql: `
      SELECT id, application_code, business_name, guarantor_name,
             stage, status, bf_application_id, created_at
        FROM bi_applications
       WHERE source = 'bf_pgi_referral'
          OR bf_application_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 100
    `,
    describe: (rows) =>
      `${rows.length} PGI application(s) originated from BF.`,
  },
  {
    key: "applications_missing_documents",
    label: "PGI applications with no documents on file",
    keywords: [
      ["missing", "without", "no"],
      ["document", "documents", "doc", "docs"],
    ],
    sql: `
      SELECT a.id, a.application_code, a.business_name, a.guarantor_name,
             a.stage, a.status, a.created_at
        FROM bi_applications a
       WHERE a.stage NOT IN ('approved','declined','policy_issued')
         AND NOT EXISTS (
           SELECT 1 FROM bi_documents d
            WHERE d.application_id = a.id
         )
       ORDER BY a.created_at DESC
       LIMIT 100
    `,
    describe: (rows) =>
      `${rows.length} PGI application(s) with no documents on file.`,
  },
  {
    key: "oldest_active_application",
    label: "Oldest active PGI application",
    keywords: [
      ["oldest"],
      ["application", "applications", "app", "apps", "deal", "deals"],
    ],
    sql: `
      SELECT id, application_code, business_name, guarantor_name,
             stage, status, created_at
        FROM bi_applications
       WHERE stage NOT IN ('approved','declined','policy_issued')
       ORDER BY created_at ASC
       LIMIT 5
    `,
    describe: (rows) =>
      rows.length
        ? `Oldest active PGI application: ${
            (rows[0] as any).application_code ?? (rows[0] as any).id
          } created ${(rows[0] as any).created_at}.`
        : "No active PGI applications found.",
  },
  {
    key: "demo_applications",
    label: "Demo PGI applications",
    keywords: [
      ["demo", "test"],
      ["application", "applications", "apps", "deal", "deals"],
    ],
    sql: `
      SELECT id, application_code, business_name, stage, status, created_at
        FROM bi_applications
       WHERE COALESCE((data->>'is_demo')::boolean, FALSE) = TRUE
          OR lower(COALESCE(status, '')) LIKE '%demo%'
       ORDER BY created_at DESC
       LIMIT 100
    `,
    describe: (rows) =>
      `${rows.length} demo PGI application(s) in the system.`,
  },
];

type MatchResult =
  | { matched: true; query: QueryDef }
  | { matched: false; supported: ReadonlyArray<{ key: string; label: string }> };

function matchQuery(question: string): MatchResult {
  const q = question.toLowerCase();
  let best: { def: QueryDef; score: number } | null = null;
  for (const def of QUERIES) {
    const allGroupsHit = def.keywords.every((group) =>
      group.some((kw) => q.includes(kw)),
    );
    if (!allGroupsHit) continue;
    const score = def.keywords.reduce(
      (acc, group) => acc + group.filter((kw) => q.includes(kw)).length,
      0,
    );
    if (!best || score > best.score) best = { def, score };
  }
  if (best) return { matched: true, query: best.def };
  return {
    matched: false,
    supported: QUERIES.map((x) => ({ key: x.key, label: x.label })),
  };
}

export type RunResult = {
  ok: boolean;
  query?: string;
  label?: string;
  rows?: ReadonlyArray<Record<string, unknown>>;
  summary?: string;
  not_supported?: boolean;
  supported_queries?: ReadonlyArray<{ key: string; label: string }>;
};

export async function runBiPipelineQuery(question: string): Promise<RunResult> {
  const m = matchQuery(question);
  if (!m.matched) {
    return {
      ok: true,
      not_supported: true,
      summary: "I can't answer that BI question yet. Here's what I can run.",
      supported_queries: m.supported,
    };
  }
  const r = await pool.query(m.query.sql);
  const rows = (r.rows ?? []) as Array<Record<string, unknown>>;
  return {
    ok: true,
    query: m.query.key,
    label: m.query.label,
    rows,
    summary: m.query.describe(rows),
  };
}

export const __test = { matchQuery, QUERIES };
