// BI_SERVER_PUSH_DISPATCH_v240
import http2 from "node:http2";
import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { pool } from "../../db";
import { buildApnsPayload, buildFcmMessage, routeDevices, type BiDevice } from "./biPushPayload";

export type BiPushKind = "DOCUMENT_REQUEST" | "APPLICATION_UPDATE";
export interface BiApnsSender { send(token: string, payload: Record<string, unknown>): Promise<{ ok: boolean; invalid: boolean }>; }
export interface BiFcmSender { send(message: ReturnType<typeof buildFcmMessage>): Promise<{ ok: boolean; invalid: boolean }>; }
type Query = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
export type BiPushDeps = { query: Query; apns: BiApnsSender | null; fcm: BiFcmSender | null };

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const INVALID_APNS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

export function biDeepLink(kind: BiPushKind, publicId: string | null | undefined): string {
  const id = String(publicId ?? "").trim();
  return kind === "DOCUMENT_REQUEST" && SAFE_ID.test(id) ? `borealrisk://requirements/${id}` : "borealrisk://home";
}

class ApnsHttp2Sender implements BiApnsSender {
  private key: KeyObject;
  private cached: { value: string; at: number } | null = null;
  private session: http2.ClientHttp2Session | null = null;
  constructor(private cfg: { teamId: string; keyId: string; privateKey: string; bundleId: string; host: string }) {
    this.key = createPrivateKey(cfg.privateKey);
  }
  private token(): string {
    const now = Date.now();
    if (this.cached && now - this.cached.at < 50 * 60 * 1000) return this.cached.value;
    const value = jwt.sign({ iss: this.cfg.teamId, iat: Math.floor(now / 1000) }, this.key, {
      algorithm: "ES256", header: { alg: "ES256", kid: this.cfg.keyId },
    });
    this.cached = { value, at: now };
    return value;
  }
  private client(): http2.ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const session = http2.connect(this.cfg.host);
    session.on("error", () => { if (this.session === session) this.session = null; });
    session.on("close", () => { if (this.session === session) this.session = null; });
    this.session = session;
    return session;
  }
  send(token: string, payload: Record<string, unknown>): Promise<{ ok: boolean; invalid: boolean }> {
    return new Promise((resolve) => {
      let status = 0;
      let body = "";
      let done = false;
      const finish = (result: { ok: boolean; invalid: boolean }) => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };
      const req = this.client().request({
        ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${this.token()}`,
        "apns-topic": this.cfg.bundleId, "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json",
      });
      const timer = setTimeout(() => { req.close(http2.constants.NGHTTP2_CANCEL); finish({ ok: false, invalid: false }); }, 10_000);
      req.setEncoding("utf8");
      req.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
      req.on("data", (chunk: string) => { if (body.length < 2048) body += chunk; });
      req.on("end", () => {
        if (status === 200) return finish({ ok: true, invalid: false });
        let reason = "";
        try { reason = String(JSON.parse(body)?.reason ?? ""); } catch { reason = ""; }
        console.warn(JSON.stringify({ event: "bi_push_apns_rejected", status, reason }));
        finish({ ok: false, invalid: INVALID_APNS.has(reason) });
      });
      req.on("error", (err) => {
        console.warn(JSON.stringify({ event: "bi_push_apns_error", message: err.message }));
        finish({ ok: false, invalid: false });
      });
      req.end(JSON.stringify(payload));
    });
  }
}

class FcmV1Sender implements BiFcmSender {
  private cached: { value: string; until: number } | null = null;
  constructor(private account: { project_id: string; client_email: string; private_key: string }) {}
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cached && now < this.cached.until) return this.cached.value;
    const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64(JSON.stringify({ iss: this.account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
    const signer = createSign("RSA-SHA256");
    signer.update(`${head}.${claim}`);
    const assertion = `${head}.${claim}.${b64(signer.sign(this.account.private_key))}`;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (!response.ok) throw new Error(`fcm_oauth_failed_${response.status}`);
    const json = await response.json() as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("fcm_oauth_no_token");
    this.cached = { value: json.access_token, until: now + Math.max(60, Number(json.expires_in ?? 3600)) - 60 };
    return json.access_token;
  }
  async send(message: ReturnType<typeof buildFcmMessage>): Promise<{ ok: boolean; invalid: boolean }> {
    try {
      const bearer = await this.accessToken();
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`, {
        method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(message),
      });
      if (response.ok) return { ok: true, invalid: false };
      const body = await response.text().catch(() => "");
      console.warn(JSON.stringify({ event: "bi_push_fcm_rejected", status: response.status }));
      return { ok: false, invalid: response.status === 404 || body.includes("UNREGISTERED") };
    } catch (err) {
      console.warn(JSON.stringify({ event: "bi_push_fcm_error", message: err instanceof Error ? err.message : String(err) }));
      return { ok: false, invalid: false };
    }
  }
}

let providers: { apns: BiApnsSender | null; fcm: BiFcmSender | null } | null = null;
export function buildBiPushProviders(env: NodeJS.ProcessEnv = process.env): { apns: BiApnsSender | null; fcm: BiFcmSender | null } {
  let apns: BiApnsSender | null = null;
  let fcm: BiFcmSender | null = null;
  const teamId = String(env.BI_APNS_TEAM_ID ?? "").trim();
  const keyId = String(env.BI_APNS_KEY_ID ?? "").trim();
  const privateKey = String(env.BI_APNS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  const bundleId = String(env.BI_APNS_BUNDLE_ID ?? "").trim();
  if (teamId && keyId && privateKey && bundleId) {
    try {
      const host = env.BI_APNS_ENVIRONMENT === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
      apns = new ApnsHttp2Sender({ teamId, keyId, privateKey, bundleId, host });
    } catch (err) {
      console.warn(JSON.stringify({ event: "bi_push_apns_not_configured", reason: err instanceof Error ? err.message : "invalid_key" }));
    }
  }
  const raw = String(env.BI_FIREBASE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (raw) {
    try {
      const account = JSON.parse(raw);
      if (account?.project_id && account?.client_email && account?.private_key) {
        account.private_key = String(account.private_key).replace(/\\n/g, "\n");
        fcm = new FcmV1Sender(account);
      }
    } catch { console.warn(JSON.stringify({ event: "bi_push_fcm_not_configured", reason: "service_account_not_json" })); }
  }
  return { apns, fcm };
}

function defaultDeps(): BiPushDeps {
  if (!providers) providers = buildBiPushProviders();
  return { query: (sql, params) => pool.query(sql, params), ...providers };
}
const recent = new Map<string, number>();
export function __resetBiPushDedupe(): void { recent.clear(); }

/** Dispatches to every registered applicant/guarantor device and never rejects. */
export async function notifyBiApplicant(input: { applicationId?: string | null; pgiApplicationId?: string | null; kind: BiPushKind; title: string; body: string; dedupeKey?: string }, deps: BiPushDeps = defaultDeps()): Promise<{ sent: number; removed: number }> {
  const byPgi = !input.applicationId && !!input.pgiApplicationId;
  const ref = String((byPgi ? input.pgiApplicationId : input.applicationId) ?? "").trim();
  if (!ref) return { sent: 0, removed: 0 };
  const key = `${byPgi ? "pgi" : "id"}:${ref}:${input.kind}:${input.dedupeKey ?? ""}`;
  const last = recent.get(key);
  if (last && Date.now() - last < 10 * 60 * 1000) return { sent: 0, removed: 0 };
  recent.set(key, Date.now());
  if (!deps.apns && !deps.fcm) return { sent: 0, removed: 0 };
  try {
    const app = await deps.query(`SELECT public_id, applicant_phone_e164, guarantor_phone FROM bi_applications WHERE ${byPgi ? "pgi_application_id::text" : "id::text"} = $1 LIMIT 1`, [ref]);
    const row = app.rows[0];
    if (!row) return { sent: 0, removed: 0 };
    const phones = [row.applicant_phone_e164, row.guarantor_phone].map((phone) => String(phone ?? "").trim()).filter(Boolean);
    if (!phones.length) return { sent: 0, removed: 0 };
    const tokens = await deps.query("SELECT token, platform FROM bi_client_push_tokens WHERE applicant_phone = ANY($1::text[])", [phones]);
    const routed = routeDevices(tokens.rows);
    const url = biDeepLink(input.kind, row.public_id);
    const data = { categoryId: input.kind, applicationId: String(row.public_id ?? "") };
    let sent = 0;
    const invalid: string[] = [];
    for (const device of routed.apns as BiDevice[]) {
      if (!deps.apns) break;
      const payload = buildApnsPayload({ title: input.title, body: input.body, url, data });
      payload.aps = { ...(payload.aps as Record<string, unknown>), category: input.kind };
      const result = await deps.apns.send(device.token, payload);
      if (result.ok) sent++; else if (result.invalid) invalid.push(device.token);
    }
    for (const device of routed.fcm as BiDevice[]) {
      if (!deps.fcm) break;
      const result = await deps.fcm.send(buildFcmMessage(device.token, { title: input.title, body: input.body, url, data }));
      if (result.ok) sent++; else if (result.invalid) invalid.push(device.token);
    }
    if (invalid.length) await deps.query("DELETE FROM bi_client_push_tokens WHERE token = ANY($1::text[])", [invalid]);
    return { sent, removed: invalid.length };
  } catch (err) {
    console.error(JSON.stringify({ event: "bi_push_dispatch_failed", kind: input.kind, message: err instanceof Error ? err.message : String(err) }));
    return { sent: 0, removed: 0 };
  }
}
