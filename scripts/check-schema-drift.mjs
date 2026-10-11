// BI_SERVER_LIVE_SCHEMA_GUARD_v6 / BI_SERVER_BLOCK_v789_SCHEMA_DRIFT_v2
// Fails the build when SQL in src/ names a column the live table does not have.
//
// The column lists come from src/db/live-schema.json, which is GENERATED from the production
// schema snapshot (src/db/baseline/000000_baseline.sql) plus newer migrations by
// scripts/generate-live-schema.mjs. This script first checks that the JSON is not stale.
//
// Usage: node scripts/check-schema-drift.mjs [sourceRoot]
//   sourceRoot (or env SCHEMA_DRIFT_SRC) defaults to "src". Every *.ts file under it is scanned,
//   except __tests__/, tests/ and migrations/ directories.
//
// What is checked (best-effort, per SQL string literal in the TypeScript source):
//   - INSERT INTO t (cols...)                      every listed column
//   - alias.col / table.col                        when alias is bound to exactly one known table in
//                                                  that string (FROM t a, JOIN t AS a, UPDATE t a,
//                                                  INSERT INTO t ... EXCLUDED.col)
//   - single-table statements only (exactly one FROM/JOIN/UPDATE/INTO target in the string, no
//     sub-SELECT, no WITH): unqualified columns in the SELECT list, UPDATE ... SET (including
//     INSERT ... ON CONFLICT DO UPDATE SET), WHERE and ORDER BY (SELECT-list aliases allowed).
// Anything the parser cannot attribute to one table is skipped rather than guessed, because
// false positives in a blocking gate get the gate switched off. Known parser false positives go
// in ALLOWLIST below with a reason.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLiveSchema, serialize } from "./generate-live-schema.mjs";

const REPO = resolve(fileURLToPath(import.meta.url), "../..");

// Parser false positives: { file (repo-relative, forward slashes), table, column, reason }.
// Keep this short; every entry needs a reason.
const ALLOWLIST = [];

// KNOWN REAL DRIFT (v789): SQL that is genuinely wrong against the live schema, found when this
// check was widened beyond INSERT. Listed so the gate (which now also gates deploys) stays green
// while the owners fix them; each is printed as a warning on every run. This is a ratchet: an
// entry that no longer matches anything FAILS the check, so delete it in the same change that
// fixes the SQL. Never add new entries here - fix the SQL instead.
const KNOWN_DRIFT = [
  ["src/routes/biApplicantProfileRoutes.ts", "bi_contacts", ["company_name"]],
  ["src/routes/biPayoutRoutes.ts", "bi_commission_payables", ["paid"]],
  ["src/routes/biPolicyRoutes.ts", "bi_policies", ["start_date", "end_date"]],
  ["src/routes/biRoutes.ts", "pgi_applications", ["first_name", "last_name", "email", "phone", "business_name", "loan_amount"]],
  ["src/services/notes/biMentions.ts", "bi_users", ["email", "full_name"]],
  ["src/worker/accrual.worker.ts", "bi_jobs", ["job_type", "error"]],
  ["src/worker/accrual.worker.ts", "bi_premium_schedule", ["policy_id", "premium_amount", "paid"]],
  ["src/worker/accrual.worker.ts", "bi_referrers", ["commission_rate"]],
  ["src/worker/accrual.worker.ts", "bi_applications", ["lead_id"]],
  ["src/worker/accrual.worker.ts", "bi_ledger", ["tx_id", "account", "debit", "credit", "description", "reference_id"]],
  ["src/worker/accrual.worker.ts", "bi_commission_payables", ["policy_id", "premium_schedule_id", "referrer_id", "gross_premium", "commission_rate", "commission_amount"]],
].flatMap(([file, table, cols]) => cols.map((column) => ({ file, table, column })));

// ---------------------------------------------------------------------------------------------
// 1. TypeScript -> SQL string literals (length-preserving so offsets map back to lines)
// ---------------------------------------------------------------------------------------------
const SQL_HINT = /\b(select|update|insert|delete)\b/i;

export function extractStrings(text) {
  const out = [];
  let i = 0;
  let lastSignificant = "";
  const n = text.length;
  const readTemplate = (start) => {
    // returns [endIndexExclusive, content with ${...} masked as "_"]
    let j = start + 1;
    let content = "";
    while (j < n) {
      const ch = text[j];
      if (ch === "\\") {
        content += "  ";
        j += 2;
        continue;
      }
      if (ch === "`") return [j + 1, content];
      if (ch === "$" && text[j + 1] === "{") {
        const end = skipExpression(j + 2);
        content += text.slice(j, end).replace(/[^\n]/g, "_");
        j = end;
        continue;
      }
      content += ch;
      j++;
    }
    return [n, content];
  };
  const skipQuoted = (start, q) => {
    let j = start + 1;
    while (j < n && text[j] !== q && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
    return j + 1;
  };
  // skip a ${ ... } expression body starting after "${"; returns index after the closing "}"
  const skipExpression = (start) => {
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      const ch = text[j];
      if (ch === "`") {
        j = readTemplate(j)[0];
        continue;
      }
      if (ch === "'" || ch === '"') {
        j = skipQuoted(j, ch);
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    return j;
  };
  while (i < n) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (ch === "/" && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(lastSignificant)) {
      // regex literal
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== "\n") {
        if (text[j] === "\\") j++;
        else if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) break;
        j++;
      }
      i = j + 1;
      lastSignificant = "x";
      continue;
    }
    if (ch === "`") {
      const [end, content] = readTemplate(i);
      if (SQL_HINT.test(content)) out.push({ offset: i + 1, sql: content });
      i = end;
      lastSignificant = "x";
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(i, ch);
      const content = text.slice(i + 1, end - 1);
      if (SQL_HINT.test(content)) out.push({ offset: i + 1, sql: content });
      i = end;
      lastSignificant = "x";
      continue;
    }
    if (!/\s/.test(ch)) {
      if (/[A-Za-z0-9_$]/.test(ch)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
        lastSignificant = text.slice(i, j) === "return" ? "return" : "x";
        i = j;
        continue;
      }
      lastSignificant = ch;
    }
    i++;
  }
  return out;
}

// Lower-case, blank out SQL comments and '...' literals, unquote "identifiers". Same length.
function normalizeSql(sql) {
  let s = sql.replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  s = s.replace(/'(?:[^']|'')*'/g, (m) => "'" + m.slice(1, -1).replace(/[^\n]/g, " ") + "'");
  s = s.replace(/"/g, " ");
  return s.toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// 2. SQL analysis
// ---------------------------------------------------------------------------------------------
const KEYWORDS = new Set(
  (
    "select from where and or not null is in any all some exists as on join left right inner outer full cross " +
    "natural lateral using group by order having limit offset asc desc nulls first last distinct union " +
    "intersect except insert into values update set delete returning conflict do nothing with recursive case " +
    "when then else end cast true false between like ilike similar escape to interval at time zone local " +
    "array row only default filter over partition window rows range preceding following unbounded current " +
    "for share nowait skip locked collate epoch year month day hour minute second week dow doy quarter " +
    "isodow millennium century decade microseconds milliseconds timezone current_date current_time " +
    "current_timestamp localtime localtimestamp current_user session_user user excluded public " +
    "text int integer bigint smallint numeric decimal real double precision float boolean bool uuid json jsonb " +
    "date timestamp timestamptz varchar char character varying regclass bytea inet citext without unknown " +
    "if begin commit rollback table index trigger function returns language plpgsql perform raise notice"
  ).split(/\s+/),
);
const IDENT_RE = /[a-z_][a-z0-9_]*/y;
const isPlaceholder = (w) => /^_+$/.test(w);

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// Paren depth at every index, and whether the innermost open paren starts a sub-SELECT.
function parenInfo(s) {
  const depth = new Int32Array(s.length + 1);
  const stack = [];
  const inFunc = new Uint8Array(s.length + 1);
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      const isSelect = /^\s*(select|with|values)\b/.test(s.slice(i + 1, i + 40));
      stack.push(isSelect);
      d++;
    } else if (ch === ")") {
      stack.pop();
      d = Math.max(0, d - 1);
    }
    depth[i] = d;
    inFunc[i] = stack.length > 0 && !stack[stack.length - 1] ? 1 : 0;
  }
  return { depth, inFunc };
}

const TARGET_RE = /\b(from|join|update|into)\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/g;

function findTargets(s, info) {
  const targets = []; // { table, alias, kind, index }
  let m;
  TARGET_RE.lastIndex = 0;
  while ((m = TARGET_RE.exec(s)) !== null) {
    const [, kind, rawTable, rawAlias] = m;
    if (kind === "from" && info.inFunc[m.index]) continue; // extract(epoch from x), substring(x from y)
    if (kind === "from" && /\bdistinct\s+$/.test(s.slice(Math.max(0, m.index - 12), m.index))) continue; // IS DISTINCT FROM
    if (kind === "update" && /\bdo\s+$/.test(s.slice(Math.max(0, m.index - 6), m.index))) continue; // ON CONFLICT DO UPDATE
    if (kind === "update" && rawTable === "set") continue;
    if (kind === "into" && !/\binsert\s+$/.test(s.slice(Math.max(0, m.index - 10), m.index))) continue; // SELECT ... INTO var
    if (KEYWORDS.has(rawTable) && rawTable !== "public") {
      // FROM (subquery), JOIN LATERAL, ... - unknown target
      if (rawTable === "lateral" || rawTable === "select") targets.push({ table: null, alias: null, kind, index: m.index });
      continue;
    }
    const alias = rawAlias && !KEYWORDS.has(rawAlias) ? rawAlias : null;
    targets.push({ table: rawTable, alias, kind, index: m.index });
    // comma-joined FROM list: FROM a x, b y
    if (kind === "from") {
      let rest = m.index + m[0].length;
      const more = /^\s*,\s*(?:public\.)?([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/;
      let mm;
      while ((mm = s.slice(rest).match(more)) && !KEYWORDS.has(mm[1]) && info.depth[rest] === info.depth[m.index]) {
        const a2 = mm[2] && !KEYWORDS.has(mm[2]) ? mm[2] : null;
        targets.push({ table: mm[1], alias: a2, kind, index: rest });
        rest += mm[0].length;
      }
    }
  }
  // FROM (SELECT ...) x / JOIN (...) AS x - x is not a table
  const subAlias = /\)\s+(?:as\s+)?([a-z_][a-z0-9_]*)/g;
  while ((m = subAlias.exec(s)) !== null) {
    if (!KEYWORDS.has(m[1])) targets.push({ table: null, alias: m[1], kind: "sub", index: m.index });
  }
  // WITH x AS (...) - x is not a table either
  const cte = /(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s+as\s*\(/g;
  while ((m = cte.exec(s)) !== null) targets.push({ table: null, alias: m[1], kind: "cte", index: m.index });
  return targets;
}

// Identifiers in an expression that look like bare column references.
function bareColumns(s, start, end) {
  const out = [];
  let i = start;
  while (i < end) {
    const ch = s[i];
    if (ch === "'") {
      const close = s.indexOf("'", i + 1);
      i = close === -1 ? end : close + 1;
      continue;
    }
    if (ch === "$") {
      i++;
      while (i < end && /[0-9]/.test(s[i])) i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      while (i < end && /[0-9a-z_.]/.test(s[i])) i++;
      continue;
    }
    if (ch === ":" && s[i + 1] === ":") {
      // cast: skip the type name (possibly several words / qualified / array)
      i += 2;
      const t = /\s*(?:public\.)?[a-z_][a-z0-9_]*(?:\s+(?:precision|varying|with(?:out)?\s+time\s+zone))?(?:\s*\[\s*\])*/y;
      t.lastIndex = i;
      const m = t.exec(s);
      if (m) i = t.lastIndex;
      continue;
    }
    IDENT_RE.lastIndex = i;
    const m = IDENT_RE.exec(s);
    if (m && (i === 0 || !/[a-z0-9_$]/.test(s[i - 1]))) {
      const word = m[0];
      const after = i + word.length;
      const next = s.slice(after).match(/^\s*(\S)/)?.[1];
      const prev = s.slice(Math.max(0, i - 3), i);
      const qualified = next === "." || /\.\s*$/.test(prev);
      const isFunc = next === "(";
      const afterAs = /\bas\s+$/.test(s.slice(Math.max(0, i - 4), i));
      if (!qualified && !isFunc && !afterAs && !KEYWORDS.has(word) && !isPlaceholder(word)) out.push({ word, index: i });
      i = after;
      continue;
    }
    i++;
  }
  return out;
}

// End of a clause starting at `start`: the first stop keyword at the same paren depth, or the
// closing paren of the enclosing group.
function clauseEnd(s, start, stops, info) {
  const base = info.depth[start];
  const re = new RegExp(String.raw`\b(?:${stops.join("|")})\b|[()]`, "g");
  re.lastIndex = start;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === ")" && info.depth[m.index] < base) return m.index;
    if (m[0] === ")" || m[0] === "(") continue;
    if (info.depth[m.index] === base) return m.index;
  }
  return s.length;
}

function splitTopLevelRange(s, start, end) {
  const parts = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push([from, i]);
      from = i + 1;
    }
  }
  parts.push([from, end]);
  return parts;
}

export function analyze(sql, tables) {
  const s = normalizeSql(sql);
  const info = parenInfo(s);
  const issues = []; // { table, column, index, clause }
  const targets = findTargets(s, info);

  // alias / name -> table (null when ambiguous or not a known table)
  const bind = new Map();
  const bindName = (name, table) => {
    if (!name) return;
    if (bind.has(name) && bind.get(name) !== table) bind.set(name, null);
    else bind.set(name, table);
  };
  for (const t of targets) {
    const known = t.table && tables[t.table] ? t.table : null;
    if (t.table) bindName(t.table, known);
    if (t.alias) bindName(t.alias, known);
  }
  const intoTargets = targets.filter((t) => t.kind === "into");
  if (intoTargets.length === 1 && tables[intoTargets[0].table] && /\bon\s+conflict\b/.test(s)) bindName("excluded", intoTargets[0].table);

  const check = (table, column, index, clause) => {
    if (!table || !tables[table] || column === "*" || isPlaceholder(column)) return;
    if (!tables[table].has(column)) issues.push({ table, column, index, clause });
  };

  // INSERT column lists
  const ins = /\binsert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/g;
  let m;
  while ((m = ins.exec(s)) !== null) {
    const table = m[1];
    if (!tables[table]) continue;
    let off = m.index + m[0].indexOf("(", m[0].indexOf(m[1]) + m[1].length) + 1;
    for (const raw of m[2].split(",")) {
      const col = raw.trim();
      if (/^[a-z_][a-z0-9_]*$/.test(col)) check(table, col, off + raw.indexOf(col), "INSERT");
      off += raw.length + 1;
    }
  }

  // qualified alias.col
  const qual = /(?<![a-z0-9_.$])([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*|\*)/g;
  while ((m = qual.exec(s)) !== null) {
    const q = m[1];
    if (q === "public" || !bind.has(q)) continue;
    if (/^\s*\.\s*[a-z_]/.test(s.slice(m.index + m[0].length))) continue; // a.b.c
    check(bind.get(q), m[2], m.index + m[0].lastIndexOf(m[2]), "qualified");
  }

  // single-table statements: unqualified columns
  const realTargets = targets.filter((t) => t.kind !== "sub" && t.kind !== "cte");
  const selects = (s.match(/\bselect\b/g) || []).length;
  if (realTargets.length === 1 && realTargets[0].table && tables[realTargets[0].table] && selects <= 1 && !/\bwith\b\s+[a-z_]/.test(s) && targets.length === 1) {
    const table = realTargets[0].table;
    const selectAliases = new Set();
    const asRe = /\bas\s+([a-z_][a-z0-9_]*)/g;
    while ((m = asRe.exec(s)) !== null) selectAliases.add(m[1]);

    // SELECT list
    const sel = /\bselect\s+(?:distinct\s+(?:on\s*\([^)]*\)\s*)?)?/g;
    if ((m = sel.exec(s)) !== null) {
      const start = m.index + m[0].length;
      const end = clauseEnd(s, start, ["from"], info);
      for (const [a, b] of splitTopLevelRange(s, start, end)) {
        let item = s.slice(a, b);
        // drop a trailing output alias: "expr AS x" or "expr x"
        const alias = item.match(/(?:\bas\s+|(?<=[a-z0-9_)\]*]\s+))([a-z_][a-z0-9_]*)\s*$/);
        let stop = b;
        if (alias && !KEYWORDS.has(alias[1]) && item.trim() !== alias[1]) {
          selectAliases.add(alias[1]);
          stop = a + alias.index;
        }
        item = s.slice(a, stop);
        for (const c of bareColumns(s, a, stop)) check(table, c.word, c.index, "SELECT");
      }
    }
    // UPDATE ... SET / ON CONFLICT DO UPDATE SET
    const setRe = /\bupdate\s+(?:(?:only\s+)?(?:public\.)?[a-z_][a-z0-9_]*(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+)?set\b/g;
    while ((m = setRe.exec(s)) !== null) {
      const head = s.slice(m.index, m.index + m[0].length);
      const named = head.match(/^update\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/);
      if (named && named[1] !== "set" && named[1] !== table) continue;
      const start = m.index + m[0].length;
      const end = clauseEnd(s, start, ["where", "from", "returning"], info);
      for (const [a, b] of splitTopLevelRange(s, start, end)) {
        const item = s.slice(a, b);
        const lhs = item.match(/^\s*([a-z_][a-z0-9_]*)\s*=/);
        if (lhs && !isPlaceholder(lhs[1])) check(table, lhs[1], a + item.indexOf(lhs[1]), "SET");
        const eq = item.indexOf("=");
        if (eq !== -1) for (const c of bareColumns(s, a + eq + 1, b)) check(table, c.word, c.index, "SET");
      }
    }
    // WHERE
    const whereRe = /\bwhere\b/g;
    while ((m = whereRe.exec(s)) !== null) {
      const start = m.index + m[0].length;
      const end = clauseEnd(s, start, ["order", "group", "limit", "offset", "returning", "for", "having", "union", "on", "do"], info);
      for (const c of bareColumns(s, start, end)) check(table, c.word, c.index, "WHERE");
    }
    // ORDER BY
    const orderRe = /\border\s+by\b/g;
    while ((m = orderRe.exec(s)) !== null) {
      const start = m.index + m[0].length;
      const end = clauseEnd(s, start, ["limit", "offset", "for", "union", "returning"], info);
      for (const c of bareColumns(s, start, end)) if (!selectAliases.has(c.word)) check(table, c.word, c.index, "ORDER BY");
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// 3. Driver
// ---------------------------------------------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "migrations" || entry === "__tests__" || entry === "tests") continue;
      out.push(...walk(p));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

export function checkSource(srcRoot, schemaObj) {
  const tables = Object.fromEntries(
    Object.entries(schemaObj).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, new Set(v)]),
  );
  const problems = [];
  for (const file of walk(srcRoot)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(resolve(srcRoot, ".."), file).split("\\").join("/");
    for (const lit of extractStrings(text)) {
      for (const issue of analyze(lit.sql, tables)) {
        const allowed = ALLOWLIST.some((a) => rel.endsWith(a.file) && a.table === issue.table && a.column === issue.column);
        if (allowed) continue;
        problems.push({ file: rel, line: lineAt(text, lit.offset + issue.index), ...issue });
      }
    }
  }
  return { problems, tableCount: Object.keys(tables).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const schemaPath = join(REPO, "src/db/live-schema.json");
  const fresh = serialize(buildLiveSchema(REPO));
  if (readFileSync(schemaPath, "utf8") !== fresh) {
    console.error("::error::src/db/live-schema.json is stale (a migration changed the schema). Run: node scripts/generate-live-schema.mjs");
    process.exit(1);
  }
  const srcRoot = resolve(process.argv[2] || process.env.SCHEMA_DRIFT_SRC || join(REPO, "src"));
  const { problems: found, tableCount } = checkSource(srcRoot, JSON.parse(fresh));
  const isKnown = (p, k) => p.file.endsWith(k.file) && p.table === k.table && p.column === k.column;
  const known = found.filter((p) => KNOWN_DRIFT.some((k) => isKnown(p, k)));
  const problems = found.filter((p) => !KNOWN_DRIFT.some((k) => isKnown(p, k)));
  // Only enforce the ratchet when scanning the real tree (an alternate root, e.g. a proof run
  // against old sources, has a different file set).
  const scanningRepoSrc = srcRoot === resolve(REPO, "src");
  const stale = scanningRepoSrc ? KNOWN_DRIFT.filter((k) => !found.some((p) => isKnown(p, k))) : [];
  for (const p of known) console.warn(`::warning::known drift ${p.file}:${p.line}  ${p.clause}: ${p.table} has no column "${p.column}"`);
  if (problems.length) {
    console.error("::error::SQL names columns the live table does not have.\n");
    for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.clause}: ${p.table} has no column "${p.column}"`);
    console.error(`\n${problems.length} problem(s). Fix the SQL, or if the schema changed add a migration and run`);
    console.error("node scripts/generate-live-schema.mjs. Parser false positives go in ALLOWLIST in this script.");
    process.exit(1);
  }
  if (stale.length) {
    console.error("::error::KNOWN_DRIFT entries no longer match anything (fixed - delete them from scripts/check-schema-drift.mjs):");
    for (const k of stale) console.error(`  ${k.file}  ${k.table}.${k.column}`);
    process.exit(1);
  }
  console.log(`Schema drift check passed: ${tableCount} tables, ${srcRoot}.`);
}
