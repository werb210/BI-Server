// BI_SERVER_BUILD_TRUTH_v18
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CODE_VERSION = "v18_BUILD_TRUTH";

function parseBuildMeta(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function readBuildMeta(): Record<string, string> {
  const candidates = [
    join(process.cwd(), "BUILD_META"),
    join(__dirname, "..", "..", "BUILD_META"),
    join(__dirname, "..", "..", "..", "BUILD_META"),
  ];
  for (const path of candidates) {
    try {
      return parseBuildMeta(readFileSync(path, "utf8"));
    } catch {
      // A missing file is normal in development and tests.
    }
  }
  return {};
}

const meta = readBuildMeta();

export const BUILD_TAG = process.env.BUILD_TAG || meta.build_tag || "unknown";
export const COMMIT_SHA = (process.env.COMMIT_SHA || meta.commit_sha || "unknown").slice(0, 12);
export const buildInfo = { codeVersion: CODE_VERSION, buildTag: BUILD_TAG, commitSha: COMMIT_SHA };

export const __parseBuildMeta = parseBuildMeta;
