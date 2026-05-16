// BI_SERVER_BLOCK_v253_APOLLO_PHASE1_SCAFFOLD_v1
// Thin Apollo.io REST client. Gated by APOLLO_API_KEY. When the
// env var is absent we run in MOCK MODE so the portal can render
// sample data before the operator's real key lands (~2 days).
// Switching to live is just setting the env var on Azure — no
// code change.
//
// Apollo API surface used by Phase 1:
//   POST /api/v1/people/match              — person enrichment
//   POST /api/v1/emailer_campaigns/search  — sequences list
//   POST /api/v1/emailer_campaigns/:id/add_contact_ids — enroll contact(s)
//   GET  /api/v1/email_accounts            — mailbox health
//
// Docs: https://docs.apollo.io/reference
import { logger } from "../platform/logger";

const APOLLO_BASE = "https://api.apollo.io";

export function apolloIsLive(): boolean {
  return Boolean(process.env.APOLLO_API_KEY?.trim());
}

type ApolloFetchOpts = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
};

async function apolloFetch<T = any>(path: string, opts: ApolloFetchOpts = {}): Promise<T> {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) {
    throw new Error("apollo_not_configured");
  }
  const url = new URL(`${APOLLO_BASE}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Cache_Control: "no-cache",
      Accept: "application/json",
      "X-Api-Key": key,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, path, body: text.slice(0, 500) }, "apollo_http_failed");
    throw new Error(`apollo_http_${res.status}`);
  }
  return (await res.json()) as T;
}

export type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  seniority?: string;
  organization?: { name?: string; primary_domain?: string };
};

export type ApolloEnrichResult = {
  ok: boolean;
  mock: boolean;
  person: ApolloPerson | null;
  raw: unknown;
};

export async function enrichPerson(args: {
  full_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
}): Promise<ApolloEnrichResult> {
  if (!apolloIsLive()) {
    // Mock mode: return a plausible enrichment so the portal
    // banner and tables can render. Marked clearly mock=true.
    return {
      ok: true,
      mock: true,
      person: args.email
        ? {
            id: "mock-apollo-person",
            first_name: (args.full_name ?? "").split(/\s+/)[0] || "Jane",
            last_name: (args.full_name ?? "").split(/\s+/).slice(1).join(" ") || "Doe",
            name: args.full_name ?? "Jane Doe",
            title: "Mock Title",
            email: args.email,
            linkedin_url: "https://linkedin.com/in/mock",
            seniority: "vp",
            organization: {
              name: args.company_name ?? "Mock Co",
              primary_domain: args.company_domain ?? "example.com",
            },
          }
        : null,
      raw: { mock: true, args },
    };
  }
  const payload: Record<string, unknown> = {
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };
  if (args.full_name) payload.name = args.full_name;
  if (args.email) payload.email = args.email;
  if (args.company_name) payload.organization_name = args.company_name;
  if (args.company_domain) payload.domain = args.company_domain;
  const data = await apolloFetch<{ person?: ApolloPerson }>("/api/v1/people/match", {
    method: "POST",
    body: payload,
  });
  return {
    ok: true,
    mock: false,
    person: data?.person ?? null,
    raw: data,
  };
}

export type ApolloSequence = {
  id: string;
  name: string;
  active?: boolean;
};

export type ApolloSequencesResult = {
  ok: boolean;
  mock: boolean;
  sequences: ApolloSequence[];
  raw: unknown;
};

export async function listSequences(): Promise<ApolloSequencesResult> {
  if (!apolloIsLive()) {
    return {
      ok: true,
      mock: true,
      sequences: [
        { id: "mock-seq-1", name: "PGI cold outreach (mock)", active: true },
        { id: "mock-seq-2", name: "Referrer nurture (mock)", active: true },
      ],
      raw: { mock: true },
    };
  }
  // BI_SERVER_BLOCK_BI_APOLLO_LIST_SEQUENCES_v1
  // Apollo does not serve GET /api/v1/emailer_campaigns -- that path
  // returns 404, which is exactly what BI Issues 9 logs captured. The
  // documented endpoint for listing sequences is
  // POST /api/v1/emailer_campaigns/search and it requires a MASTER API
  // key (Pro plan or above). If the key is not a master key Apollo
  // responds 403 and apolloFetch surfaces apollo_http_403 -- a clearer
  // signal than a stale 404.
  const data = await apolloFetch<{ emailer_campaigns?: any[] }>(
    "/api/v1/emailer_campaigns/search",
    { method: "POST", body: { page: 1, per_page: 100 } },
  );
  const campaigns = Array.isArray(data?.emailer_campaigns) ? data.emailer_campaigns : [];
  return {
    ok: true,
    mock: false,
    sequences: campaigns.map((c: any) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? ""),
      active: Boolean(c.active),
    })),
    raw: data,
  };
}

export type ApolloEnrollResult = {
  ok: boolean;
  mock: boolean;
  apollo_contact_id: string | null;
  raw: unknown;
};

export async function enrollContact(args: {
  apollo_sequence_id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}): Promise<ApolloEnrollResult> {
  if (!apolloIsLive()) {
    return {
      ok: true,
      mock: true,
      apollo_contact_id: "mock-apollo-contact",
      raw: { mock: true, args },
    };
  }
  const data = await apolloFetch<any>(
    `/api/v1/emailer_campaigns/${encodeURIComponent(args.apollo_sequence_id)}/add_contact_ids`,
    {
      method: "POST",
      body: {
        emailer_campaign_id: args.apollo_sequence_id,
        send_email_from_email_account_id: null,
        contacts: [
          {
            email: args.email,
            first_name: args.first_name ?? undefined,
            last_name: args.last_name ?? undefined,
            organization_name: args.company_name ?? undefined,
          },
        ],
      },
    },
  );
  const contactId =
    (Array.isArray(data?.contacts) && data.contacts[0]?.id) ||
    data?.contact?.id ||
    null;
  return {
    ok: true,
    mock: false,
    apollo_contact_id: contactId ? String(contactId) : null,
    raw: data,
  };
}

export type ApolloMailboxHealth = {
  id: string;
  email?: string;
  status?: string;
  health_score?: number;
  bounce_rate?: number;
  reply_rate?: number;
};

export type ApolloMailboxResult = {
  ok: boolean;
  mock: boolean;
  mailboxes: ApolloMailboxHealth[];
  raw: unknown;
};

export async function listMailboxes(): Promise<ApolloMailboxResult> {
  if (!apolloIsLive()) {
    return {
      ok: true,
      mock: true,
      mailboxes: [
        {
          id: "mock-mbx-1",
          email: "andrew@boreal.financial",
          status: "active",
          health_score: 92,
          bounce_rate: 0.02,
          reply_rate: 0.11,
        },
      ],
      raw: { mock: true },
    };
  }
  const data = await apolloFetch<{ email_accounts?: any[] }>(
    "/api/v1/email_accounts",
    { method: "GET" },
  );
  const accs = Array.isArray(data?.email_accounts) ? data.email_accounts : [];
  return {
    ok: true,
    mock: false,
    mailboxes: accs.map((a: any) => ({
      id: String(a.id ?? ""),
      email: a.email,
      status: a.status,
      health_score: a.health_score,
      bounce_rate: a.bounce_rate,
      reply_rate: a.reply_rate,
    })),
    raw: data,
  };
}

// BI_SERVER_BLOCK_BI_ROUND8_APOLLO_v1 -- single-contact lookup by
// email. Apollo's people/match endpoint returns one canonical row
// per email. Returns null when no match (HTTP 404 from Apollo) so
// the route handler can distinguish "no data" from "API failed".
async function enrichByEmail(email: string): Promise<Record<string, unknown> | null> {
  if (!process.env.APOLLO_API_KEY) {
    throw new Error("APOLLO_API_KEY not configured");
  }
  const url = "https://api.apollo.io/api/v1/people/match";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.APOLLO_API_KEY,
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({ email, reveal_personal_emails: false }),
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Apollo ${r.status}: ${body.slice(0, 200)}`);
  }
  const json = (await r.json()) as { person?: Record<string, unknown> };
  return json.person ?? null;
}

export const apolloClient = {
  enrichByEmail,
};
