// BI_AUDIT_FIX_v58 — pin the public router contract.
import { describe, it, expect, vi } from "vitest";
vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../services/crmMirrorService", () => ({ mirrorToContact: vi.fn() }));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/storage", () => ({ getStorage: vi.fn() }));
import biPublicApplicationRoutes from "../biPublicApplicationRoutes";
// BI_UNQUARANTINE_FINAL_v1 - the router gained routes since this list was
// written. Regenerated from the source; it is a change-detector, and its
// job is to make additions deliberate rather than to stay at three.
describe("BI_AUDIT_FIX_v58 public application router", () => {
  it("registers exactly the six public PGI endpoints", () => {
    const stack = (biPublicApplicationRoutes as any).stack;
    const routes = stack.map((l:any)=>l.route).filter(Boolean).map((r:any)=>`${Object.keys(r.methods)[0]?.toUpperCase()} ${r.path}`).sort();
    expect(routes).toEqual([
      "GET /applications/:publicId",
      "GET /applications/:publicId/documents",
      "PATCH /applications/:publicId",
      "POST /applications/:publicId/documents",
      "POST /applications/:publicId/submit",
      "POST /applications/score",
    ]);
  });
});
