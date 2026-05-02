// BI_BLOCK_PGI_FULL_APP_v1 — Crockford-style 8-char app id.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePublicId(): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return out;
}
