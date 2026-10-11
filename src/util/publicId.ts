// BI_BLOCK_PGI_FULL_APP_v1 - Crockford-style application id.
// BI_SERVER_v789_PUBLIC_ID - the public id is the only credential on the public
// application link, so it is drawn from crypto.randomInt (not Math.random) and
// is 12 characters long (32^12 = 2^60). Ids issued earlier are 8 characters;
// lookups must keep accepting them, so nothing may validate the length.
import crypto from "node:crypto";

export const PUBLIC_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PUBLIC_ID_LENGTH = 12;

export function generatePublicId(): string {
  let out = "";
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) {
    out += PUBLIC_ID_ALPHABET[crypto.randomInt(PUBLIC_ID_ALPHABET.length)];
  }
  return out;
}
