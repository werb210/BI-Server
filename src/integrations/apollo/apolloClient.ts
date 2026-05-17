import { logger } from "../../platform/logger";

export const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

type Json = Record<string, unknown>;

export class ApolloError extends Error {
  constructor(public readonly status: number, public readonly body: unknown, message?: string) {
    super(message ?? `Apollo API error: ${status}`);
    this.name = "ApolloError";
  }
}

export type ApolloRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: Json;
  signal?: AbortSignal;
  maxRetries?: number;
};

function getApiKey(): string {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error("APOLLO_API_KEY is not configured");
  return key;
}

function buildUrl(path: string, query?: ApolloRequestOptions["query"]): string {
  const url = new URL(path.startsWith("/") ? path.slice(1) : path, `${APOLLO_BASE_URL}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true }
    );
  });
}

export async function apolloRequest<T = unknown>(path: string, options: ApolloRequestOptions = {}): Promise<T> {
  const { method = "GET", query, body, signal } = options;
  const maxRetries = options.maxRetries ?? 3;
  const url = buildUrl(path, query);

  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": getApiKey(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (res.status === 429 && attempt <= maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** (attempt - 1), 8000);
      logger.warn({ attempt, backoffMs, path }, "Apollo 429 — backing off");
      await sleep(backoffMs, signal);
      continue;
    }

    if (res.status >= 500 && attempt <= Math.min(maxRetries, 2)) {
      logger.warn({ attempt, status: res.status, path }, "Apollo 5xx — retrying");
      await sleep(1000 * attempt, signal);
      continue;
    }

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!res.ok) throw new ApolloError(res.status, parsed);
    return parsed as T;
  }
}

export type ApolloPerson = {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string }>;
  title?: string;
  seniority?: string;
  linkedin_url?: string;
  organization?: {
    id?: string;
    name?: string;
    industry?: string;
    estimated_num_employees?: number;
    annual_revenue?: number;
    website_url?: string;
    linkedin_url?: string;
  };
  contact_stage?: { id?: string; name?: string };
  account_stage?: { id?: string; name?: string };
};

export async function matchPerson(args: {
  email?: string;
  first_name?: string;
  last_name?: string;
  linkedin_url?: string;
  reveal_personal_emails?: boolean;
}): Promise<{ person: ApolloPerson | null }> {
  const res = await apolloRequest<{ person?: ApolloPerson }>("/people/match", {
    method: "POST",
    query: { reveal_personal_emails: args.reveal_personal_emails ?? false },
    body: {
      email: args.email,
      first_name: args.first_name,
      last_name: args.last_name,
      linkedin_url: args.linkedin_url,
    },
  });
  return { person: res?.person ?? null };
}

export async function searchContacts(args: {
  page?: number;
  per_page?: number;
  updated_at_min?: string;
  contact_stage_names?: string[];
  currently_in_sequence?: boolean;
  // BI_SERVER_BLOCK_58_APOLLO_LIST_IMPORT_v1
  label_ids?: string[];
}): Promise<{ contacts: ApolloPerson[]; pagination: { page: number; per_page: number; total_entries: number; total_pages: number } }> {
  const body: Json = { page: args.page ?? 1, per_page: Math.min(args.per_page ?? 100, 100) };
  if (args.contact_stage_names?.length) body.contact_stage_names = args.contact_stage_names;
  if (args.currently_in_sequence) body.currently_in_sequence = true;
  if (args.updated_at_min) body.updated_at_min = args.updated_at_min;
  if (args.label_ids?.length) body.label_ids = args.label_ids;

  const res = await apolloRequest<{ contacts?: ApolloPerson[]; pagination?: { page: number; per_page: number; total_entries: number; total_pages: number } }>("/contacts/search", { method: "POST", body });
  return {
    contacts: res?.contacts ?? [],
    pagination: res?.pagination ?? { page: 1, per_page: 100, total_entries: 0, total_pages: 0 },
  };
}

export type ApolloEmailerMessage = {
  id: string;
  contact_id?: string;
  email_account_id?: string;
  subject?: string;
  body_text?: string;
  delivered_at?: string;
  opened_at?: string;
  clicked_at?: string;
  replied_at?: string;
  bounced_at?: string;
  emailer_campaign_id?: string;
  emailer_campaign?: { name?: string };
};

export async function listEmailerMessages(args: {
  page?: number;
  per_page?: number;
  date_range_min?: string;
}): Promise<{ messages: ApolloEmailerMessage[]; pagination: { page: number; per_page: number; total_entries: number; total_pages: number } }> {
  const body: Json = { page: args.page ?? 1, per_page: Math.min(args.per_page ?? 100, 100) };
  if (args.date_range_min) body.date_range_min = args.date_range_min;

  const res = await apolloRequest<{ emailer_messages?: ApolloEmailerMessage[]; pagination?: { page: number; per_page: number; total_entries: number; total_pages: number } }>("/emailer_messages/search", { method: "POST", body });
  return {
    messages: res?.emailer_messages ?? [],
    pagination: res?.pagination ?? { page: 1, per_page: 100, total_entries: 0, total_pages: 0 },
  };
}


// BI_APOLLO_RUN_v55_PHASE3 — lead-gen + sequence + email-account endpoints.
export type PeopleSearchFilters = { page?: number; per_page?: number; person_titles?: string[]; person_seniorities?: string[]; organization_industry_tag_ids?: string[]; organization_industries?: string[]; organization_num_employees_ranges?: string[]; person_locations?: string[]; organization_locations?: string[]; };
export async function searchPeople(filters: PeopleSearchFilters){ const body: Record<string, unknown> = { page: filters.page ?? 1, per_page: Math.min(filters.per_page ?? 25, 100)}; for (const [k,v] of Object.entries(filters)){ if(k!=="page"&&k!=="per_page"&&Array.isArray(v)&&v.length) body[k]=v;} const res = await apolloRequest<any>("/mixed_people/search", {method:"POST", body}); return { people: res?.people ?? [], pagination: res?.pagination ?? {page:1, per_page:25,total_entries:0,total_pages:0}};}
export async function addContactsToSequence(sequenceId:string, contactIds:string[], emailAccountId?:string){ if(!contactIds.length) return {enrolled:0, raw:null}; const res=await apolloRequest<unknown>(`/emailer_campaigns/${encodeURIComponent(sequenceId)}/add_contact_ids`, {method:"POST", body:{contact_ids:contactIds, send_email_from_email_account_id:emailAccountId}}); return {enrolled:contactIds.length, raw:res}; }
export type ApolloEmailAccount={id:string; email?:string; send_limit_per_day?:number; emails_sent_today?:number; bounce_rate?:number; reply_rate?:number; status?:string};
export async function listEmailAccounts(){ const res=await apolloRequest<any>("/email_accounts", {method:"GET"}); return {email_accounts: res?.email_accounts ?? []}; }
export type ApolloSequence={id:string; name?:string; active?:boolean; archived?:boolean; num_steps?:number};
export async function listSequences(args:{page?:number; per_page?:number}={}){ const res=await apolloRequest<any>("/emailer_campaigns/search", {method:"POST", body:{page:args.page??1, per_page:Math.min(args.per_page??100,100)}}); return {sequences:res?.emailer_campaigns??[], pagination:res?.pagination ?? {page:1, per_page:100,total_entries:0,total_pages:0}};}
export async function createApolloContact(p:{ first_name?: string; last_name?: string; email?: string; title?: string; organization_name?: string; phone?: string; }){ const res=await apolloRequest<any>("/contacts", {method:"POST", body:p as any}); return res?.contact ?? null; }

// BI_SERVER_BLOCK_58_APOLLO_LIST_IMPORT_v1 — Apollo "labels" (saved lists).
// Apollo's internal name for a user-saved list is "label". The list page in
// the Apollo UI maps 1:1 to a label row. count_modifier holds the live
// member count (Apollo recalculates lazily). Some Apollo plans return
// `labels` (Pro+) and others wrap it as { labels: [...] } — handle both.
export type ApolloLabel = {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  cached_count?: number;
};
export async function listLabels(): Promise<{ labels: ApolloLabel[] }> {
  const res = await apolloRequest<any>("/labels", { method: "GET" });
  const labels: ApolloLabel[] = Array.isArray(res) ? res : (res?.labels ?? []);
  return { labels };
}
