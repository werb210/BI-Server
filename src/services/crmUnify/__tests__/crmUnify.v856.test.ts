// BI_SERVER_v856_CRM_UNIFY - the pure rules behind the shared CRM in BI (same as BF-Server v856): tags, clean-up
// text rules, the SSRF guard, duplicate matching, company people and company details. No database.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSystemTag, labelForTag, normalizeTag, normalizeTags, parseTagFilter, tagFromLabel, tagKind, untaggedSql } from "../tags";
import {
  formatPhoneDisplay, isAllCapsOrLower, properCaseCompanyName, properCasePersonName, proposeCompanyFixes, proposeContactFixes, toE164,
} from "../textClean";
import { checkUrl, isBlockedAddress, safeFetchText, websiteFor, type LookupFn } from "../webSource";
import { companyNamesSimilar, companyReasons, normCompanyName, pickFieldChoices, samePersonName } from "../duplicates";
import { applicationPeople, groupFor, personKey } from "../people";
import { buildCompanyDetails, detailUpdates } from "../companyDetails";
import { validChange } from "../cleanup";

describe("tags", () => {
  it("normalises case, spaces, punctuation and known synonyms", () => {
    expect(normalizeTag("Contact form")).toBe("contact_form");
    expect(normalizeTag("  LENDER ")).toBe("lender");
    expect(normalizeTag("Account/Book Keeper")).toBe("accountant");
    expect(normalizeTag("Accountant/advisor")).toBe("accountant");
    expect(normalizeTag("booked-call")).toBe("booked_call");
    expect(normalizeTags(["Lender", "lender", " LENDER", "Contact form", "contact_form", "", null])).toEqual(["contact_form", "lender"]);
  });
  it("classifies core, system, custom and other tags", () => {
    expect(tagKind("Active")).toBe("core");
    expect(tagKind("application_started")).toBe("system");
    expect(tagKind("Contact form")).toBe("system");
    expect(tagKind("vip", new Set(["vip"]))).toBe("custom");
    expect(tagKind("old free text")).toBe("other");
    expect(isSystemTag("Booked call")).toBe(true);
    expect(labelForTag("accountant")).toBe("Accountant/Bookkeeper");
    expect(tagFromLabel("  Insurance   agent ")).toEqual({ slug: "insurance_agent", label: "Insurance agent" });
    expect(tagFromLabel("   ")).toBeNull();
  });
  it("parses the list filter (any of, untagged) and builds the untagged SQL", () => {
    expect(parseTagFilter({ tags: "Lender,__none__" })).toEqual({ tags: ["lender"], untagged: true });
    expect(parseTagFilter({ tag: "active" })).toEqual({ tags: ["active"], untagged: false });
    expect(untaggedSql("c.tags", 4)).toContain("$4::text[]");
  });
});

describe("clean-up text rules", () => {
  it("proper-cases people, keeping Mc / Mac / O' / hyphens and particles", () => {
    expect(properCasePersonName("JOHN O'BRIEN-MCDONALD")).toBe("John O'Brien-McDonald");
    expect(properCasePersonName("mary macdonald")).toBe("Mary MacDonald");
    expect(properCasePersonName("ALAN MACK")).toBe("Alan Mack");
    expect(properCasePersonName("anna van der berg")).toBe("Anna van der Berg");
    expect(isAllCapsOrLower("John Smith")).toBe(false);
  });
  it("proper-cases companies and writes LLC, Inc., Ltd.", () => {
    expect(properCaseCompanyName("POKE PROD LLC")).toBe("Poke Prod LLC");
    expect(properCaseCompanyName("acme widgets inc")).toBe("Acme Widgets Inc.");
    expect(properCaseCompanyName("NORTHERN GATEWAY FILMS LTD")).toBe("Northern Gateway Films Ltd.");
    expect(properCaseCompanyName("BIBUSA CN LLC")).toBe("Bibusa CN LLC");
    expect(properCaseCompanyName("parish construction and roofing")).toBe("Parish Construction and Roofing");
  });
  it("stores phones as E.164 and shows them as (403) 555-0123", () => {
    expect(toE164("(403) 555-0123")).toBe("+14035550123");
    expect(toE164("1-403-555-0123")).toBe("+14035550123");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("555-0123")).toBeNull();
    expect(formatPhoneDisplay("+14035550123")).toBe("(403) 555-0123");
  });
  it("proposes contact fixes, and the real name for an application-started placeholder", () => {
    const fixes = proposeContactFixes({ name: "Unknown (application started)", email: " Sean.Dwyer@Gmail.com", phone: "323-898-2498" }, { first: "sean", last: "dwyer" });
    expect(fixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "name", after: "Sean Dwyer" }),
      expect.objectContaining({ field: "email", after: "sean.dwyer@gmail.com" }),
      expect.objectContaining({ field: "phone", after: "+13238982498" }),
    ]));
    expect(proposeContactFixes({ name: "Sean Dwyer", email: "sean@x.com", phone: "+13238982498" })).toEqual([]);
    expect(proposeContactFixes({ first_name: "JOHN", last_name: "smith  " })).toEqual([
      expect.objectContaining({ field: "first_name", after: "John", reason: "All capitals" }),
      expect.objectContaining({ field: "last_name", after: "Smith" }),
    ]);
  });
  it("proposes company fixes", () => {
    expect(proposeCompanyFixes({ name: "POKE PROD LLC", phone: "4035550123" })).toEqual([
      expect.objectContaining({ field: "name", after: "Poke Prod LLC" }),
      expect.objectContaining({ field: "phone", after: "+14035550123" }),
    ]);
  });
  it("only accepts BI fields in a change", () => {
    expect(validChange({ entity: "contact", entityId: "11111111-1111-4111-8111-111111111111", field: "phone_e164", before: "4035550123", after: "+14035550123" })).toBe(true);
    expect(validChange({ entity: "contact", entityId: "11111111-1111-4111-8111-111111111111", field: "outreach_status", before: "a", after: "b" })).toBe(false);
    expect(validChange({ entity: "company", entityId: "11111111-1111-4111-8111-111111111111", field: "legal_name", before: "ACME", after: "Acme" })).toBe(true);
  });
});

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local and reserved addresses (v4 and v6)", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "ff02::1", "2001:db8::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.72.14", "2607:f8b0:4005:80a::200e", "::ffff:8.8.8.8"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it("allows only http/https on 80/443 to DNS names", () => {
    expect(checkUrl("file:///etc/passwd", [80, 443])).toMatchObject({ ok: false, error: "scheme_not_allowed" });
    expect(checkUrl("http://127.0.0.1/", [80, 443])).toMatchObject({ ok: false, error: "ip_literal_not_allowed" });
    expect(checkUrl("http://[::1]/", [80, 443])).toMatchObject({ ok: false, error: "ip_literal_not_allowed" });
    expect(checkUrl("http://localhost/", [80, 443])).toMatchObject({ ok: false, error: "host_not_allowed" });
    expect(checkUrl("http://metadata.internal/", [80, 443])).toMatchObject({ ok: false, error: "host_not_allowed" });
    expect(checkUrl("https://acme.com:8443/", [80, 443])).toMatchObject({ ok: false, error: "port_not_allowed" });
    expect(checkUrl("https://user:pw@acme.com/", [80, 443])).toMatchObject({ ok: false, error: "credentials_not_allowed" });
    expect(checkUrl("https://acme.com/about", [80, 443]).ok).toBe(true);
  });
  it("uses the website field, else a work email domain, and skips free mail providers", () => {
    expect(websiteFor("www.allencapfunding.com", [])).toMatchObject({ host: "allencapfunding.com", from: "website" });
    expect(websiteFor("", ["pokedwyer@gmail.com", "x@shaw.ca", "Tony@AllenCapFunding.com"])).toMatchObject({ host: "allencapfunding.com", from: "email" });
    expect(websiteFor(null, ["a@outlook.com", "b@hotmail.com", "c@yahoo.ca", "d@icloud.com", "e@live.com", "f@aol.com", "g@proton.me", "h@telus.net"])).toBeNull();
  });

  describe("fetching (local test server, DNS faked)", () => {
    let server: http.Server;
    let port = 0;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === "/to-private") { res.writeHead(302, { location: `http://evil.test:${port}/` }); return res.end(); }
        if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); return res.end(); }
        if (req.url === "/big") { res.writeHead(200, { "content-type": "text/html" }); res.end("<p>" + "x".repeat(5000) + "</p>"); return; }
        if (req.url === "/pdf") { res.writeHead(200, { "content-type": "application/pdf" }); return res.end("%PDF"); }
        if (req.url === "/slow") { setTimeout(() => { res.writeHead(200, { "content-type": "text/html" }); res.end("late"); }, 1500); return; }
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><head><title>Acme</title></head><body><script>x()</script><h1>We build decks</h1></body></html>");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));
    // site.test resolves to the test server; evil.test resolves to a private address.
    const lookup: LookupFn = (host, _o, cb) => cb(null, host === "site.test" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.7", family: 4 }]);
    const opts = () => ({ lookup, ports: [port], isAllowedAddress: (ip: string) => ip === "127.0.0.1" });

    it("reads an allowed page", async () => {
      const r = await safeFetchText(`http://site.test:${port}/`, opts());
      expect(r).toMatchObject({ ok: true, status: 200 });
      if (r.ok) expect(r.body).toContain("We build decks");
    });
    it("refuses a host that resolves to a private address", async () => {
      expect(await safeFetchText(`http://evil.test:${port}/`, opts())).toMatchObject({ ok: false, error: "blocked_address" });
    });
    it("checks every redirect hop", async () => {
      expect(await safeFetchText(`http://site.test:${port}/to-private`, opts())).toMatchObject({ ok: false, error: "blocked_address" });
      expect(await safeFetchText(`http://site.test:${port}/loop`, opts())).toMatchObject({ ok: false, error: "too_many_redirects" });
    });
    it("caps size and time, and reads text only", async () => {
      const big = await safeFetchText(`http://site.test:${port}/big`, { ...opts(), maxBytes: 1000 });
      expect(big.ok && big.body.length).toBe(1000);
      expect(await safeFetchText(`http://site.test:${port}/pdf`, opts())).toMatchObject({ ok: false, error: "not_text" });
      expect(await safeFetchText(`http://site.test:${port}/slow`, { ...opts(), timeoutMs: 300 })).toMatchObject({ ok: false, error: "timeout" });
    });
  });
});

describe("duplicates", () => {
  it("compares company names without suffixes and punctuation", () => {
    expect(normCompanyName("Northern Gateway Films Inc.")).toBe("northern gateway films");
    expect(companyNamesSimilar("Northern Gateway Films", "Northern Gateway Films Inc.")).toBe(true);
    expect(companyNamesSimilar("Northern Ga", "Northern Gateway Films")).toBe(false);
    expect(companyNamesSimilar("Accord Finacial", "Accord Financial")).toBe(false);
    expect(companyReasons({ legal_name: "Accord Financial", website: "accord.ca" }, { legal_name: "ACCORD FINANCIAL LTD", website: "https://www.accord.ca/x" })).toEqual(["Same name", "Same website"]);
  });
  it("matches people by surname and a compatible first name, never placeholders", () => {
    expect(samePersonName("Mike Cotic", "MICHAEL COTIC")).toBe(true);
    expect(samePersonName("Mike Cotic", "Mike Jones")).toBe(false);
    expect(samePersonName("New applicant (+15872292529)", "New applicant (+15872292529)")).toBe(false);
    expect(pickFieldChoices([{ key: "email" }], [{ email: "a@x.co" }], { email: "evil@x.co" })).toEqual([]);
  });
});

describe("company people and details", () => {
  it("finds partners typed into the application data", () => {
    expect(applicationPeople({ applicant: { partnerFirstName: "Elizabeth", partnerLastName: "Cullen", partnerEmail: "e@x.co" } }))
      .toEqual([expect.objectContaining({ role: "partner", name: "Elizabeth Cullen", email: "e@x.co" })]);
    expect(groupFor("lawyer")).toBe("advisors");
    expect(personKey({ contactId: "abc" })).toBe("contact:abc");
  });
  it("falls back to the application and validates edits", () => {
    const fields = buildCompanyDetails(
      { legal_name: "Northern Gateway Films", city: null, created_at: "2026-09-23T00:00:00Z", owner_id: null },
      { business_address: "1 Main St", business_website: "ngf.ca", entity_type: "corporation", formation_date: "2019-05-01", data: { business: { city: "Toronto" } } },
    );
    const f = (k: string) => fields.find((x) => x.key === k)!;
    expect(f("name")).toMatchObject({ value: "Northern Gateway Films", source: "company" });
    expect(f("address")).toMatchObject({ value: "1 Main St", source: "application" });
    expect(f("city")).toMatchObject({ value: "Toronto", source: "application" });
    expect(f("domain")).toMatchObject({ value: "ngf.ca" });
    expect(detailUpdates({ city: " Calgary ", employees: "7", name: "Acme" })).toEqual({ ok: true, sets: [["city", "Calgary"], ["employees", 7], ["legal_name", "Acme"]] });
    expect(detailUpdates({ name: "" })).toMatchObject({ ok: false });
  });
});
