// BI_SERVER_BUILD_TRUTH_v18
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../db", () => ({
  pool: {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

import app from "../server";
import { BUILD_TAG, CODE_VERSION, COMMIT_SHA, __parseBuildMeta } from "../platform/buildInfo.js";
import { renderProbe } from "../routes/biInternalBuildRoutes.js";

describe("BUILD_META runtime metadata", () => {
  it("parses the deploy workflow format", () => {
    expect(__parseBuildMeta("build_tag=v64-20260807\ncommit_sha=abc12345\n"))
      .toEqual({ build_tag: "v64-20260807", commit_sha: "abc12345" });
  });

  it("provides safe fallback values", () => {
    expect(typeof BUILD_TAG).toBe("string");
    expect(typeof COMMIT_SHA).toBe("string");
    expect(CODE_VERSION).toBe("v19_ASSET_CORP");
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

// v789 [5]/[37]: was a grep of server.ts mount lines; now requests against the
// real app. v789 deliberately made the build probe staff-only, so "public"
// became "401 without a token, 200 for staff" on both prefixes - and still
// answered by this router, not swallowed by another guard mounted earlier.
describe("build route mounting", () => {
  const staff = () => jwt.sign({ sub: "staff-1", role: "Admin" }, process.env.JWT_SECRET as string);

  it("is mounted on both prefixes and needs staff auth (v789)", async () => {
    for (const path of ["/api/v1/_int/build", "/api/v1/bi/_int/build"]) {
      expect((await request(app).get(path)).status, path).toBe(401);
      const applicant = jwt.sign({ kind: "applicant", phone: "+15875550000" }, process.env.JWT_SECRET as string);
      expect((await request(app).get(path).set("Authorization", `Bearer ${applicant}`)).status, path).toBe(403);
    }
  });

  it("staff reach the build handler itself on both prefixes", async () => {
    for (const path of ["/api/v1/_int/build", "/api/v1/bi/_int/build"]) {
      const r = await request(app).get(path).set("Authorization", `Bearer ${staff()}`);
      expect(r.status, path).toBe(200);
      expect(r.body).toMatchObject({ service: "bi-server", codeVersion: CODE_VERSION, buildTag: BUILD_TAG, commitSha: COMMIT_SHA });
      expect(r.body.renderProbe).toMatchObject({ heroImage: true, rightImage: true, secondCta: true });
    }
  });
});
