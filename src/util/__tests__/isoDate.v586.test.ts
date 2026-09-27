// BI_SERVER_BLOCK_v586_BF_HANDOFF_DATES
import { describe, it, expect } from "vitest";
import { toIsoDate } from "../isoDate";

describe("toIsoDate", () => {
  it("keeps real dates", () => {
    expect(toIsoDate("1980-01-02")).toBe("1980-01-02");
    expect(toIsoDate("2015-06-01T00:00:00.000Z")).toBe("2015-06-01");
    expect(toIsoDate("2015/06/15")).toBe("2015-06-15");
  });
  it("turns a year or year-month into the first day", () => {
    expect(toIsoDate("2015")).toBe("2015-01-01");
    expect(toIsoDate("2015-06")).toBe("2015-06-01");
    expect(toIsoDate("June 2015")).toBe("2015-06-01");
    expect(toIsoDate("Sept. 2019")).toBe("2019-09-01");
  });
  it("reads day/month order only when it is unambiguous", () => {
    expect(toIsoDate("25/12/1980")).toBe("1980-12-25");
    expect(toIsoDate("12/25/1980")).toBe("1980-12-25");
    expect(toIsoDate("03/04/1980")).toBeNull();
  });
  it("returns null for anything else", () => {
    for (const v of ["", "  ", "soon", "2015-13-01", "2015-02-30", "1776", null, undefined, 2015]) expect(toIsoDate(v as any)).toBeNull();
  });
});
