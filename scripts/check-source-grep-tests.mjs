// BI_SERVER_BLOCK_v789_SOURCE_GREP_RATCHET
// Counts "source-grep" tests: *.test.ts files under src/ that read repository files with
// readFileSync / readFile to assert on their TEXT instead of exercising behaviour. They pass
// while the code is broken and fail on harmless refactors, so the count may only go down.
//
// Heuristic (deliberately simple, documented so the number is reproducible):
//   A test file counts when it calls readFileSync(...) or readFile(...) (fs, fs/promises,
//   fs.promises) AND at least one of:
//     (a) a read call's argument text mentions "src/" or contains a string literal that is a
//         path ending in .ts/.sql/.mjs/.js/.json/.yml/.yaml (e.g. "../biRoutes.ts",
//         "package.json", path.resolve(__dirname, "../x.ts"));
//     (b) a read call's argument is not a literal (a variable / helper such as
//         read(rel) => readFileSync(join(process.cwd(), rel))) and the file contains a string
//         literal that is a path ending in one of those extensions (e.g. read("db/index.ts")).
//   Files that only read temp files they wrote themselves (no such literals) do not count.
//
// Fails when the count exceeds maxSourceGrepTests in scripts/source-grep-baseline.json.
// Usage: node scripts/check-source-grep-tests.mjs   (always prints the list) / npm run check:source-grep
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(import.meta.url), "../..");
const EXT = String.raw`\.(?:ts|sql|mjs|js|json|ya?ml)`;
const PATH_LITERAL = new RegExp(String.raw`(["'\`])[^"'\`\n]*${EXT}\1`);
const READ_CALL = /\b(?:readFileSync|readFile)\s*\(/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== "node_modules") out.push(...walk(p));
    } else if (entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

// Argument text of the call whose "(" ends at `open`.
function callArgs(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

export function isSourceGrepTest(text) {
  const code = text.replace(/^\s*\/\/.*$/gm, "");
  let m;
  let indirect = false;
  READ_CALL.lastIndex = 0;
  while ((m = READ_CALL.exec(code)) !== null) {
    const args = callArgs(code, m.index + m[0].length - 1);
    const firstArg = args.split(/,(?![^(]*\))/)[0] ?? "";
    if (/src\//.test(firstArg) || PATH_LITERAL.test(firstArg)) return true; // (a)
    if (!/^\s*["'`]/.test(firstArg)) indirect = true;
  }
  return indirect && PATH_LITERAL.test(code); // (b)
}

export function findSourceGrepTests(root = join(REPO, "src")) {
  return walk(root)
    .filter((f) => isSourceGrepTest(readFileSync(f, "utf8")))
    .map((f) => relative(REPO, f).split("\\").join("/"))
    .sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = JSON.parse(readFileSync(join(REPO, "scripts/source-grep-baseline.json"), "utf8"));
  const max = Number(baseline.maxSourceGrepTests);
  const found = findSourceGrepTests();
  for (const f of found) console.log(`  ${f}`);
  console.log(`\n${found.length} source-grep test file(s); ceiling ${max} (scripts/source-grep-baseline.json).`);
  if (found.length > max) {
    console.error(`::error::${found.length - max} more test file(s) assert on source text than the ceiling allows.`);
    console.error("Write a behaviour test instead (supertest against the router, db mocked by SQL content).");
    process.exit(1);
  }
  if (found.length < max) {
    console.log(`Below the ceiling: lower maxSourceGrepTests to ${found.length} in scripts/source-grep-baseline.json.`);
  }
}
