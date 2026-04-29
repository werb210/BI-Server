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
}): Promise<{ contacts: ApolloPerson[]; pagination: { page: number; per_page: number; total_entries: number; total_pages: number } }> {
  const body: Json = { page: args.page ?? 1, per_page: Math.min(args.per_page ?? 100, 100) };
  if (args.contact_stage_names?.length) body.contact_stage_names = args.contact_stage_names;
  if (args.currently_in_sequence) body.currently_in_sequence = true;
  if (args.updated_at_min) body.updated_at_min = args.updated_at_min;

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
