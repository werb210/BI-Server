// BI_BOOT_FIX_v64_IISNODE_SHIM — Azure Windows Web Apps run Node via
// iisnode, which by convention loads server.js from the deploy root.
// This shim requires dist/index.js (the real entrypoint), keeping the
// TypeScript build output where it belongs.
//
// Why a shim instead of just renaming dist/index.js to dist/server.js:
// iisnode looks for server.js *at the root*, not inside dist/. We
// could put compiled output at the root, but that pollutes the repo
// and breaks the dev → tsc → dist workflow.
//
// Why not point iisnode directly at dist/index.js: the path resolution
// in web.config gets fragile when entry points live in subdirectories
// — relative require() calls inside dist/* keep working only because
// __dirname stays inside dist/.

"use strict";

console.log(JSON.stringify({
  level: "info",
  msg: "[BI_BOOT_FIX_v64] iisnode shim loading dist/index.js",
  ts: new Date().toISOString(),
  build: process.env.BUILD_TAG || "unknown",
  sha: (process.env.COMMIT_SHA || "unknown").slice(0, 8),
  node: process.version,
  pid: process.pid,
  cwd: process.cwd(),
}));

require("./dist/index.js");
