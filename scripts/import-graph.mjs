// BI_SERVER_BLOCK_v789_IMPORT_GRAPH
// Lists the .ts files reachable from an entry point by following RELATIVE imports:
//   import ... from "./x", import "./x", export ... from "./x", import("./x"), require("./x").
// Usage:
//   node scripts/import-graph.mjs [entry=src/index.ts]            reachable files
//   node scripts/import-graph.mjs [entry] --unreachable [dir=src]  .ts files under dir NOT reachable
//                                                                  (tests, __tests__ and .d.ts excluded)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'`])(\.{1,2}\/[^"'`]+)\1/g;

function resolveSpec(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, base + ".ts", base + ".tsx", base.replace(/\.js$/, ".ts"), join(base, "index.ts")];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

export function reachable(entry) {
  const seen = new Set();
  const stack = [resolve(entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    const text = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
    let m;
    SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(text)) !== null) {
      const target = resolveSpec(file, m[2]);
      if (target && !seen.has(target)) stack.push(target);
    }
  }
  return seen;
}

function allTs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "__tests__" || e === "tests") continue;
      out.push(...allTs(p));
    } else if (e.endsWith(".ts") && !e.endsWith(".d.ts") && !/\.test\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const entry = args.find((a) => !a.startsWith("--")) ?? "src/index.ts";
const seen = reachable(entry);
if (args.includes("--unreachable")) {
  const dir = args.filter((a) => !a.startsWith("--"))[1] ?? "src";
  for (const f of allTs(resolve(dir)).filter((f) => !seen.has(f)).sort()) console.log(relative(process.cwd(), f));
} else {
  for (const f of [...seen].sort()) console.log(relative(process.cwd(), f));
}
