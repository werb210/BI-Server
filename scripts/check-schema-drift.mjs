// BI_SERVER_LIVE_SCHEMA_GUARD_v6
// Fails the build when an INSERT names a column the live table does not have.
//
// Four separate production defects this session were the same mistake: SQL
// written against one of two conflicting CREATE TABLE definitions, failing at
// the database and landing in a catch. Nothing caught them because the SQL is
// a string - tsc cannot see it and the tests never ran.
//
// Only INSERT column lists are checked. They are unambiguous to parse and they
// are where the damage was. SELECT and WHERE clauses are not, because bare
// column names in a JOIN cannot be attributed to a table without a real parser,
// and false positives in a blocking gate get the gate switched off.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const schema = JSON.parse(readFileSync("src/db/live-schema.json", "utf8"));
const tables = Object.fromEntries(
  Object.entries(schema).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, new Set(v)]),
);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "migrations" || entry === "__tests__" || entry === "tests") continue;
      out.push(...walk(p));
    } else if (entry.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const problems = [];
for (const file of walk("src")) {
  const text = readFileSync(file, "utf8");
  const re = /INSERT\s+INTO\s+(bi_\w+)\s*\(([^)]*)\)/gis;
  let m;
  while ((m = re.exec(text)) !== null) {
    const table = m[1].toLowerCase();
    const known = tables[table];
    if (!known) continue;
    const cols = m[2].split(",").map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);
    const bad = cols.filter((c) => /^[a-z_][a-z0-9_]*$/.test(c) && !known.has(c));
    if (bad.length) {
      const line = text.slice(0, m.index).split("\n").length;
      problems.push({ file, line, table, bad });
    }
  }
}

if (problems.length) {
  console.error("::error::INSERT statements name columns the live table does not have.\n");
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`);
    console.error(`      ${p.table} has no: ${p.bad.join(", ")}`);
    console.error(`      live columns: ${[...tables[p.table]].join(", ")}\n`);
  }
  console.error("If the live schema changed, refresh src/db/live-schema.json - see the _comment in it.");
  process.exit(1);
}

console.log(`Schema drift check passed: ${Object.keys(tables).length} tables, no drifted INSERTs.`);
