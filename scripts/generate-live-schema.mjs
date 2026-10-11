// BI_SERVER_BLOCK_v789_LIVE_SCHEMA_GENERATOR
// Generates src/db/live-schema.json (the column lists scripts/check-schema-drift.mjs checks SQL
// against) from the schema snapshot instead of a hand-maintained copy:
//
//   1. every CREATE TABLE in src/db/baseline/000000_baseline.sql (pg_dump of production), then
//   2. every migration in src/db/migrations/ that is NOT listed in the baseline manifest
//      (src/db/baseline/000000_baseline.files.txt), in file order, best-effort:
//        CREATE TABLE [IF NOT EXISTS] t (...)          -> new table with its columns
//        ALTER TABLE [IF EXISTS] [ONLY] t ADD [COLUMN] [IF NOT EXISTS] c ...
//        ALTER TABLE t RENAME COLUMN a TO b / DROP COLUMN [IF EXISTS] c
//
// Usage:
//   node scripts/generate-live-schema.mjs           rewrite src/db/live-schema.json
//   node scripts/generate-live-schema.mjs --check   exit 1 if the JSON is stale
// The JSON shape is unchanged: { "_comment": [...], "<table>": ["col", ...], ... }.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(import.meta.url), "../..");
const IDENT = String.raw`"?([A-Za-z_][A-Za-z0-9_]*)"?`;

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

// Body of the parenthesised list that starts at `open` (index of "("), quote-aware.
function parenBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      i = text.indexOf("'", i + 1);
      while (i !== -1 && text[i + 1] === "'") i = text.indexOf("'", i + 2);
      if (i === -1) return null;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of body) {
    if (ch === "'") quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const NOT_A_COLUMN = new Set(["constraint", "primary", "unique", "foreign", "check", "exclude", "like"]);

function columnsOf(body) {
  const cols = [];
  for (const part of splitTopLevel(body)) {
    const m = part.trim().match(new RegExp("^" + IDENT));
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (NOT_A_COLUMN.has(name)) continue;
    cols.push(name);
  }
  return cols;
}

function applyCreateTables(sql, tables, { onlyNew }) {
  const re = new RegExp(
    String.raw`CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?` + IDENT + String.raw`\s*\(`,
    "gi",
  );
  let m;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    const body = parenBody(sql, m.index + m[0].length - 1);
    if (body == null) continue;
    if (onlyNew && tables.has(table)) continue; // CREATE TABLE IF NOT EXISTS on an existing table adds nothing
    tables.set(table, columnsOf(body));
  }
}

function applyAlterTables(sql, tables) {
  const re = new RegExp(
    String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?public"?\.)?` + IDENT + String.raw`\s+([\s\S]*?);`,
    "gi",
  );
  let m;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    const cols = tables.get(table);
    if (!cols) continue;
    for (const action of splitTopLevel(m[2])) {
      const a = action.trim();
      let x;
      if ((x = a.match(new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?` + IDENT, "i")))) {
        const col = x[1].toLowerCase();
        if (!NOT_A_COLUMN.has(col) && !cols.includes(col)) cols.push(col);
      } else if ((x = a.match(new RegExp(String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?` + IDENT, "i")))) {
        const col = x[1].toLowerCase();
        if (col !== "constraint") {
          const i = cols.indexOf(col);
          if (i !== -1) cols.splice(i, 1);
        }
      } else if ((x = a.match(new RegExp(String.raw`^RENAME\s+(?:COLUMN\s+)?` + IDENT + String.raw`\s+TO\s+` + IDENT, "i")))) {
        const i = cols.indexOf(x[1].toLowerCase());
        if (i !== -1 && x[1].toLowerCase() !== "constraint") cols[i] = x[2].toLowerCase();
      }
    }
  }
}

export function buildLiveSchema(repoRoot = REPO) {
  const baselineDir = join(repoRoot, "src/db/baseline");
  const migrationsDir = join(repoRoot, "src/db/migrations");
  const tables = new Map();

  const baseline = stripSqlComments(readFileSync(join(baselineDir, "000000_baseline.sql"), "utf8"));
  applyCreateTables(baseline, tables, { onlyNew: false });
  applyAlterTables(baseline, tables);

  const manifestPath = join(baselineDir, "000000_baseline.files.txt");
  const covered = existsSync(manifestPath)
    ? new Set(readFileSync(manifestPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean))
    : new Set();
  const newer = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql") && !covered.has(f)).sort();
  for (const file of newer) {
    const sql = stripSqlComments(readFileSync(join(migrationsDir, file), "utf8"));
    applyCreateTables(sql, tables, { onlyNew: true });
    applyAlterTables(sql, tables);
  }

  const out = {
    _comment: [
      "GENERATED by scripts/generate-live-schema.mjs - do not edit by hand.",
      "Source: src/db/baseline/000000_baseline.sql (pg_dump of production) plus the",
      "CREATE TABLE / ALTER TABLE ADD|DROP|RENAME COLUMN statements of every migration",
      "newer than the baseline manifest (src/db/baseline/000000_baseline.files.txt).",
      "Regenerate after adding a migration: node scripts/generate-live-schema.mjs",
      "scripts/check-schema-drift.mjs fails when this file is stale.",
      `Newer migrations folded in: ${newer.join(", ") || "(none)"}`,
    ],
  };
  for (const name of [...tables.keys()].sort()) out[name] = tables.get(name);
  return out;
}

export function serialize(schema) {
  const lines = ["{"];
  const entries = Object.entries(schema);
  entries.forEach(([k, v], i) => {
    const comma = i === entries.length - 1 ? "" : ",";
    if (k === "_comment") lines.push(`  "_comment": [\n${v.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ]${comma}`);
    else lines.push(`  ${JSON.stringify(k)}: [${v.map((c) => JSON.stringify(c)).join(",")}]${comma}`);
  });
  lines.push("}");
  return lines.join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = join(REPO, "src/db/live-schema.json");
  const next = serialize(buildLiveSchema(REPO));
  if (process.argv.includes("--check")) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== next) {
      console.error("::error::src/db/live-schema.json is stale. Run: node scripts/generate-live-schema.mjs");
      process.exit(1);
    }
    console.log("src/db/live-schema.json is up to date.");
  } else {
    writeFileSync(target, next);
    console.log(`Wrote ${target} (${Object.keys(JSON.parse(next)).length - 1} tables).`);
  }
}
