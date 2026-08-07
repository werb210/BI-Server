// BI_SERVER_BUILD_TRUTH_v18
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BUILD_TAG, CODE_VERSION, COMMIT_SHA, __parseBuildMeta } from "../platform/buildInfo.js";
import { renderProbe } from "../routes/biInternalBuildRoutes.js";

const lines = readFileSync("src/server.ts", "utf8").split("\n");

describe("BUILD_META runtime metadata", () => {
  it("parses the deploy workflow format", () => {
    expect(__parseBuildMeta("build_tag=v64-20260807\ncommit_sha=abc12345\n"))
      .toEqual({ build_tag: "v64-20260807", commit_sha: "abc12345" });
  });

  it("provides safe fallback values", () => {
    expect(typeof BUILD_TAG).toBe("string");
    expect(typeof COMMIT_SHA).toBe("string");
    expect(CODE_VERSION).toBe("v18_BUILD_TRUTH");
  });

  it("ships BUILD_META in the deploy package", () => {
    const workflow = readFileSync(".github/workflows/main_boreal-staff-server.yml", "utf8");
    expect(workflow).toContain("BUILD_META");
    expect(workflow).toContain("cp BUILD_META _deploy/");
  });
});

describe("/_int/build render probe", () => {
  const probe = renderProbe();
  it("emits both column images and the second CTA", () => {
    expect(probe.heroImage).toBe(true);
    expect(probe.rightImage).toBe(true);
    expect(probe.secondCta).toBe(true);
    expect(probe.imgCount).toBe(3);
  });
  it("reports surviving passthrough keys", () => {
    expect(probe.keysReceived).toEqual(expect.arrayContaining(["heroUrl", "rightImageUrl", "cta2Url"]));
  });
});

describe("build route mounting", () => {
  const mounts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.includes("biInternalBuildRoutes") && line.includes("app.use"));
  it("is mounted publicly on both prefixes", () => {
    expect(mounts.some(({ line }) => line.includes('app.use("/api/v1",'))).toBe(true);
    expect(mounts.some(({ line }) => line.includes('app.use("/api/v1/bi",'))).toBe(true);
    expect(mounts.every(({ line }) => !line.includes("requireAuth"))).toBe(true);
  });
  it("precedes every matching requireAuth mount", () => {
    const firstMount = Math.min(...mounts.map(({ index }) => index));
    const guards = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes("app.use(") && line.includes("requireAuth") && line.includes('"/api/v1'));
    expect(guards.length).toBeGreaterThan(0);
    expect(guards.every(({ index }) => firstMount < index)).toBe(true);
  });
});
