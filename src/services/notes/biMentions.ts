// BI_V1_FINAL_v47 — extract + resolve @mentions against bi_users.
import { pool } from "../../db";

const MENTION_RE = /(^|[\s(])@([a-zA-Z0-9_.\-]{2,40})/g;

export function extractMentionTokens(body: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(body)) !== null) out.add(m[2].toLowerCase());
  return [...out];
}

export async function resolveMentionUserIds(tokens: string[]): Promise<string[]> {
  if (!tokens.length) return [];
  try {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM bi_users
        WHERE LOWER(COALESCE(email, full_name)) = ANY($1::text[])
           OR LOWER(SPLIT_PART(email, '@', 1)) = ANY($1::text[])`,
      [tokens]
    );
    return r.rows.map((row) => row.id);
  } catch {
    return [];
  }
}

export async function parseAndResolveMentions(body: string): Promise<string[]> {
  const tokens = extractMentionTokens(body);
  if (!tokens.length) return [];
  return resolveMentionUserIds(tokens);
}
