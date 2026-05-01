// BI_AUDIT_FIX_v58 — pin the public router contract.
import { describe, it, expect, vi } from "vitest";
vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../services/crmMirrorService", () => ({ mirrorToContact: vi.fn() }));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/storage", () => ({ getStorage: vi.fn() }));
import biPublicApplicationRoutes from "../biPublicApplicationRoutes";
describe("BI_AUDIT_FIX_v58 public application router", () => {
  it("registers exactly the three public PGI endpoints", () => {
    const stack = (biPublicApplicationRoutes as any).stack;
    const routes = stack.map((l:any)=>l.route).filter(Boolean).map((r:any)=>`${Object.keys(r.methods)[0]?.toUpperCase()} ${r.path}`).sort();
    expect(routes).toEqual(["POST /applications/:id/documents","POST /applications/:id/sign","POST /applications/public"]);
  });
});
