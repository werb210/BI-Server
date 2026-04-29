import { describe, it, expect, vi, beforeEach } from "vitest";
const queryMock = vi.fn();
vi.mock("../../../db", () => ({ pool: { query: queryMock } }));
describe("upsertApolloContact", () => {
  beforeEach(() => queryMock.mockReset());
  it("updates existing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "co-1" }] }).mockResolvedValueOnce({ rows: [{ id: "contact-1" }] }).mockResolvedValueOnce({ rows: [] });
    const { upsertApolloContact } = await import("../apolloContactSync");
    const r = await upsertApolloContact({ id: "apollo-id-1", name: "Jane", email: "jane@acme.com", organization: { name: "Acme" } });
    expect(r.created).toBe(false);
  });
});
